//! Screen Time Tariff — winner-takes-pool model.
//!
//! * Members stake SOL into a program-controlled vault PDA.
//! * The oracle (backend) slashes members for screen time over the allowance.
//!   Slashed lamports STAY IN THE VAULT and accumulate in `Group.penalty_pool`.
//! * After `period_end` the oracle submits the winner(s) via `settle`; the pool
//!   is split among them (ties: equal split, remainder to the lowest pubkey).
//! * Every member then pulls their own payout with `withdraw`.
//!
//! TRUST MODEL: usage is measured off-chain. The oracle decides how many
//! minutes each member was over the limit and who won. The program guarantees
//! that the oracle can only (a) move stake into the penalty pool, capped at each
//! member's stake, and (b) award that pool to members of the group. It can never
//! withdraw to an arbitrary address or touch more than the group's own funds.
//! If the oracle never settles, `emergency_refund` returns every original
//! deposit after `period_end + grace_secs`.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub const MAX_MEMBERS: u32 = 8;

#[program]
pub mod screen_time_tariff {
    use super::*;

    pub fn create_group(
        ctx: Context<CreateGroup>,
        group_id: u64,
        oracle: Pubkey,
        allowance_minutes: u32,
        tariff_lamports_per_min: u64,
        period_end: i64,
        grace_secs: i64,
    ) -> Result<()> {
        require!(tariff_lamports_per_min > 0, TariffError::InvalidRules);
        require!(grace_secs >= 0, TariffError::InvalidRules);
        require!(
            period_end > Clock::get()?.unix_timestamp,
            TariffError::InvalidRules
        );

        // Pre-fund the vault with the rent-exempt minimum so it can never be
        // drained below rent exemption by partial withdrawals.
        let min = Rent::get()?.minimum_balance(0);
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            min,
        )?;

        let g = &mut ctx.accounts.group;
        g.admin = ctx.accounts.admin.key();
        g.oracle = oracle;
        g.group_id = group_id;
        g.allowance_minutes = allowance_minutes;
        g.tariff_lamports_per_min = tariff_lamports_per_min;
        g.period_end = period_end;
        g.grace_secs = grace_secs;
        g.member_count = 0;
        g.total_staked = 0;
        g.penalty_pool = 0;
        g.settled = false;
        g.winner_count = 0;
        g.bump = ctx.bumps.group;
        g.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn join_and_stake(ctx: Context<JoinAndStake>, amount: u64) -> Result<()> {
        require!(amount > 0, TariffError::ZeroAmount);
        require!(
            Clock::get()?.unix_timestamp < ctx.accounts.group.period_end,
            TariffError::PeriodOver
        );
        require!(
            ctx.accounts.group.member_count < MAX_MEMBERS,
            TariffError::GroupFull
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.wallet.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let m = &mut ctx.accounts.member;
        m.group = ctx.accounts.group.key();
        m.wallet = ctx.accounts.wallet.key();
        m.deposited = amount;
        m.balance = amount;
        m.total_slashed = 0;
        m.total_received = 0;
        m.minutes_charged = 0;
        m.withdrawn = false;
        m.bump = ctx.bumps.member;

        let g = &mut ctx.accounts.group;
        g.member_count = g.member_count.checked_add(1).ok_or(TariffError::Math)?;
        g.total_staked = g.total_staked.checked_add(amount).ok_or(TariffError::Math)?;

        emit!(Joined {
            group: g.key(),
            wallet: m.wallet,
            amount,
        });
        Ok(())
    }

    /// Oracle-only. `total_minutes_over` is CUMULATIVE for the period; only the
    /// difference from `minutes_charged` is charged, so retries are harmless.
    /// The penalty moves from the member's balance into the group's penalty
    /// pool (lamports never leave the vault), capped at the remaining balance.
    pub fn slash(ctx: Context<Slash>, total_minutes_over: u32) -> Result<()> {
        require!(!ctx.accounts.group.settled, TariffError::AlreadySettled);

        let delta = total_minutes_over.saturating_sub(ctx.accounts.member.minutes_charged);
        if delta == 0 {
            return Ok(());
        }
        let owed = (delta as u64)
            .checked_mul(ctx.accounts.group.tariff_lamports_per_min)
            .ok_or(TariffError::Math)?;
        let amount = owed.min(ctx.accounts.member.balance);

        // Always advance the counter, even when the stake is exhausted.
        let m = &mut ctx.accounts.member;
        m.minutes_charged = total_minutes_over;
        m.balance -= amount;
        m.total_slashed = m.total_slashed.checked_add(amount).ok_or(TariffError::Math)?;

        let g = &mut ctx.accounts.group;
        g.penalty_pool = g.penalty_pool.checked_add(amount).ok_or(TariffError::Math)?;

        emit!(Slashed {
            group: g.key(),
            wallet: m.wallet,
            minutes_charged: delta,
            lamports: amount,
            total_minutes_over,
            penalty_pool: g.penalty_pool,
        });
        Ok(())
    }

    /// Oracle-only, after `period_end`, once. Remaining accounts are the winning
    /// members' `Member` PDAs (writable), sorted by strictly ascending pubkey.
    /// The pool is split equally; the remainder goes to the first (lowest) key.
    pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
        require!(!ctx.accounts.group.settled, TariffError::AlreadySettled);
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.group.period_end,
            TariffError::PeriodNotOver
        );

        let winners = ctx.remaining_accounts;
        require!(
            !winners.is_empty() && winners.len() as u32 <= ctx.accounts.group.member_count,
            TariffError::BadWinners
        );
        for w in winners.windows(2) {
            require!(w[0].key() < w[1].key(), TariffError::BadWinners);
        }

        let group_key = ctx.accounts.group.key();
        let pool = ctx.accounts.group.penalty_pool;
        let k = winners.len() as u64;
        let share = pool / k;
        let remainder = pool - share * k;

        for (i, info) in winners.iter().enumerate() {
            let mut w: Account<Member> = Account::try_from(info)?;
            require_keys_eq!(w.group, group_key, TariffError::BadWinners);
            let credit = if i == 0 { share + remainder } else { share };
            w.balance = w.balance.checked_add(credit).ok_or(TariffError::Math)?;
            w.total_received = w.total_received.checked_add(credit).ok_or(TariffError::Math)?;
            w.exit(&crate::ID)?;
        }

        let g = &mut ctx.accounts.group;
        g.penalty_pool = 0;
        g.settled = true;
        g.winner_count = winners.len() as u32;

        emit!(Settled {
            group: group_key,
            winner_count: g.winner_count,
            pool,
        });
        Ok(())
    }

    /// After settlement, a member pulls their balance (unspent stake + any prize).
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        require!(ctx.accounts.group.settled, TariffError::NotSettled);
        require!(!ctx.accounts.member.withdrawn, TariffError::AlreadyWithdrawn);

        let amount = ctx.accounts.member.balance;
        ctx.accounts.member.balance = 0;
        ctx.accounts.member.withdrawn = true;
        pay_from_vault(&ctx.accounts.group, &ctx.accounts.vault, &ctx.accounts.wallet, &ctx.accounts.system_program, amount)?;

        emit!(Withdrawn {
            group: ctx.accounts.group.key(),
            wallet: ctx.accounts.wallet.key(),
            amount,
        });
        Ok(())
    }

    /// Liveness escape hatch: if the oracle never settles within
    /// `period_end + grace_secs`, every member can take back their ORIGINAL deposit.
    pub fn emergency_refund(ctx: Context<Withdraw>) -> Result<()> {
        let g = &ctx.accounts.group;
        require!(!g.settled, TariffError::AlreadySettled);
        require!(
            Clock::get()?.unix_timestamp >= g.period_end.saturating_add(g.grace_secs),
            TariffError::GraceNotOver
        );
        require!(!ctx.accounts.member.withdrawn, TariffError::AlreadyWithdrawn);

        let amount = ctx.accounts.member.deposited;
        ctx.accounts.member.balance = 0;
        ctx.accounts.member.withdrawn = true;
        pay_from_vault(&ctx.accounts.group, &ctx.accounts.vault, &ctx.accounts.wallet, &ctx.accounts.system_program, amount)?;

        emit!(Withdrawn {
            group: ctx.accounts.group.key(),
            wallet: ctx.accounts.wallet.key(),
            amount,
        });
        Ok(())
    }
}

fn pay_from_vault<'info>(
    group: &Account<'info, Group>,
    vault: &SystemAccount<'info>,
    to: &Signer<'info>,
    system_program: &Program<'info, System>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let group_key = group.key();
    let seeds: &[&[u8]] = &[b"vault", group_key.as_ref(), &[group.vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: to.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

// ───────────────────────────── accounts ─────────────────────────────

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct CreateGroup<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Group::INIT_SPACE,
        seeds = [b"group", admin.key().as_ref(), &group_id.to_le_bytes()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinAndStake<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(mut)]
    pub group: Account<'info, Group>,
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump = group.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        init,
        payer = wallet,
        space = 8 + Member::INIT_SPACE,
        seeds = [b"member", group.key().as_ref(), wallet.key().as_ref()],
        bump
    )]
    pub member: Account<'info, Member>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Slash<'info> {
    #[account(address = group.oracle @ TariffError::Unauthorized)]
    pub oracle: Signer<'info>,
    #[account(mut)]
    pub group: Account<'info, Group>,
    #[account(
        mut,
        has_one = group,
        seeds = [b"member", group.key().as_ref(), member.wallet.as_ref()],
        bump = member.bump
    )]
    pub member: Account<'info, Member>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(address = group.oracle @ TariffError::Unauthorized)]
    pub oracle: Signer<'info>,
    #[account(mut)]
    pub group: Account<'info, Group>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(mut)]
    pub group: Account<'info, Group>,
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump = group.vault_bump)]
    pub vault: SystemAccount<'info>,
    #[account(
        mut,
        has_one = group,
        has_one = wallet,
        seeds = [b"member", group.key().as_ref(), wallet.key().as_ref()],
        bump = member.bump
    )]
    pub member: Account<'info, Member>,
    pub system_program: Program<'info, System>,
}

// ───────────────────────────── state ─────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Group {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub group_id: u64,
    pub allowance_minutes: u32,
    pub tariff_lamports_per_min: u64,
    pub period_end: i64,
    pub grace_secs: i64,
    pub member_count: u32,
    /// Sum of all deposits (never decreases; informational).
    pub total_staked: u64,
    /// Forfeited penalties held in the vault until settlement.
    pub penalty_pool: u64,
    pub settled: bool,
    pub winner_count: u32,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub deposited: u64,
    /// Unspent stake (deposit − slashed); after settle also includes any prize.
    pub balance: u64,
    pub total_slashed: u64,
    pub total_received: u64,
    /// Cumulative minutes over the allowance already charged (idempotency).
    pub minutes_charged: u32,
    pub withdrawn: bool,
    pub bump: u8,
}

// ───────────────────────────── events ─────────────────────────────

#[event]
pub struct Joined {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Slashed {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub minutes_charged: u32,
    pub lamports: u64,
    pub total_minutes_over: u32,
    pub penalty_pool: u64,
}

#[event]
pub struct Settled {
    pub group: Pubkey,
    pub winner_count: u32,
    pub pool: u64,
}

#[event]
pub struct Withdrawn {
    pub group: Pubkey,
    pub wallet: Pubkey,
    pub amount: u64,
}

// ───────────────────────────── errors ─────────────────────────────

#[error_code]
pub enum TariffError {
    #[msg("Only the group's oracle can do this")]
    Unauthorized,
    #[msg("Invalid group rules")]
    InvalidRules,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("The staking period has ended")]
    PeriodOver,
    #[msg("The period has not ended yet")]
    PeriodNotOver,
    #[msg("Group is full")]
    GroupFull,
    #[msg("Winners must be distinct members of this group, sorted by ascending pubkey")]
    BadWinners,
    #[msg("Group already settled")]
    AlreadySettled,
    #[msg("Group not settled yet")]
    NotSettled,
    #[msg("Grace period after period end has not elapsed")]
    GraceNotOver,
    #[msg("Already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Math overflow")]
    Math,
}
