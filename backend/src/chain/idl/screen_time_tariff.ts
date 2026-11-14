/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/screen_time_tariff.json`.
 */
export type ScreenTimeTariff = {
  "address": "GfR8egohvnFsdcLfPEJFccd1an274TVsfPhpWsUR3CGi",
  "metadata": {
    "name": "screenTimeTariff",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Screen Time Tariff - group staking vault with oracle-only slashing"
  },
  "instructions": [
    {
      "name": "createGroup",
      "discriminator": [
        79,
        60,
        158,
        134,
        61,
        199,
        56,
        248
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "group",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  111,
                  117,
                  112
                ]
              },
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "arg",
                "path": "groupId"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        },
        {
          "name": "oracle",
          "type": "pubkey"
        },
        {
          "name": "allowanceMinutes",
          "type": "u32"
        },
        {
          "name": "tariffLamportsPerMin",
          "type": "u64"
        },
        {
          "name": "periodEnd",
          "type": "i64"
        },
        {
          "name": "graceSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "emergencyRefund",
      "docs": [
        "Liveness escape hatch: if the oracle never settles within",
        "`period_end + grace_secs`, every member can take back their ORIGINAL deposit."
      ],
      "discriminator": [
        188,
        73,
        52,
        195,
        137,
        70,
        180,
        147
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "group",
          "writable": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "joinAndStake",
      "discriminator": [
        144,
        143,
        186,
        255,
        137,
        200,
        75,
        22
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true
        },
        {
          "name": "group",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Oracle-only, after `period_end`, once. Remaining accounts are the winning",
        "members' `Member` PDAs (writable), sorted by strictly ascending pubkey.",
        "The pool is split equally; the remainder goes to the first (lowest) key."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true
        },
        {
          "name": "group",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "slash",
      "docs": [
        "Oracle-only. `total_minutes_over` is CUMULATIVE for the period; only the",
        "difference from `minutes_charged` is charged, so retries are harmless.",
        "The penalty moves from the member's balance into the group's penalty",
        "pool (lamports never leave the vault), capped at the remaining balance."
      ],
      "discriminator": [
        204,
        141,
        18,
        161,
        8,
        177,
        92,
        142
      ],
      "accounts": [
        {
          "name": "oracle",
          "signer": true
        },
        {
          "name": "group",
          "writable": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "member.wallet",
                "account": "member"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "totalMinutesOver",
          "type": "u32"
        }
      ]
    },
    {
      "name": "withdraw",
      "docs": [
        "After settlement, a member pulls their balance (unspent stake + any prize)."
      ],
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "wallet",
          "writable": true,
          "signer": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "group",
          "writable": true,
          "relations": [
            "member"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "group"
              }
            ]
          }
        },
        {
          "name": "member",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  109,
                  98,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "group"
              },
              {
                "kind": "account",
                "path": "wallet"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "group",
      "discriminator": [
        209,
        249,
        208,
        63,
        182,
        89,
        186,
        254
      ]
    },
    {
      "name": "member",
      "discriminator": [
        54,
        19,
        162,
        21,
        29,
        166,
        17,
        198
      ]
    }
  ],
  "events": [
    {
      "name": "joined",
      "discriminator": [
        16,
        20,
        44,
        48,
        132,
        189,
        68,
        98
      ]
    },
    {
      "name": "settled",
      "discriminator": [
        232,
        210,
        40,
        17,
        142,
        124,
        145,
        238
      ]
    },
    {
      "name": "slashed",
      "discriminator": [
        98,
        59,
        249,
        154,
        233,
        53,
        98,
        194
      ]
    },
    {
      "name": "withdrawn",
      "discriminator": [
        20,
        89,
        223,
        198,
        194,
        124,
        219,
        13
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the group's oracle can do this"
    },
    {
      "code": 6001,
      "name": "invalidRules",
      "msg": "Invalid group rules"
    },
    {
      "code": 6002,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "periodOver",
      "msg": "The staking period has ended"
    },
    {
      "code": 6004,
      "name": "periodNotOver",
      "msg": "The period has not ended yet"
    },
    {
      "code": 6005,
      "name": "groupFull",
      "msg": "Group is full"
    },
    {
      "code": 6006,
      "name": "badWinners",
      "msg": "Winners must be distinct members of this group, sorted by ascending pubkey"
    },
    {
      "code": 6007,
      "name": "alreadySettled",
      "msg": "Group already settled"
    },
    {
      "code": 6008,
      "name": "notSettled",
      "msg": "Group not settled yet"
    },
    {
      "code": 6009,
      "name": "graceNotOver",
      "msg": "Grace period after period end has not elapsed"
    },
    {
      "code": 6010,
      "name": "alreadyWithdrawn",
      "msg": "Already withdrawn"
    },
    {
      "code": 6011,
      "name": "math",
      "msg": "Math overflow"
    }
  ],
  "types": [
    {
      "name": "group",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oracle",
            "type": "pubkey"
          },
          {
            "name": "groupId",
            "type": "u64"
          },
          {
            "name": "allowanceMinutes",
            "type": "u32"
          },
          {
            "name": "tariffLamportsPerMin",
            "type": "u64"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "memberCount",
            "type": "u32"
          },
          {
            "name": "totalStaked",
            "docs": [
              "Sum of all deposits (never decreases; informational)."
            ],
            "type": "u64"
          },
          {
            "name": "penaltyPool",
            "docs": [
              "Forfeited penalties held in the vault until settlement."
            ],
            "type": "u64"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "winnerCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "joined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "member",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "balance",
            "docs": [
              "Unspent stake (deposit − slashed); after settle also includes any prize."
            ],
            "type": "u64"
          },
          {
            "name": "totalSlashed",
            "type": "u64"
          },
          {
            "name": "totalReceived",
            "type": "u64"
          },
          {
            "name": "minutesCharged",
            "docs": [
              "Cumulative minutes over the allowance already charged (idempotency)."
            ],
            "type": "u32"
          },
          {
            "name": "withdrawn",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "settled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "winnerCount",
            "type": "u32"
          },
          {
            "name": "pool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "slashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "minutesCharged",
            "type": "u32"
          },
          {
            "name": "lamports",
            "type": "u64"
          },
          {
            "name": "totalMinutesOver",
            "type": "u32"
          },
          {
            "name": "penaltyPool",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "withdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "group",
            "type": "pubkey"
          },
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
