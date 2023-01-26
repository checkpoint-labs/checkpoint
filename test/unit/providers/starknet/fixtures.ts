export const spaceDeployedEventData = [
  '0x77d5345916a48b88ad002ead40344edbaa3a900d66c40d0b8e0c4c9f529d9a6',
  '0x3993631a1336a81c474e2cf5ebbb3e820547ad14e6f6a7afcdac9d35eaccac5',
  '0x0',
  '0x0',
  '0x15180',
  '0x1',
  '0x0',
  '0x77d5345916a48b88ad002ead40344edbaa3a900d66c40d0b8e0c4c9f529d9a6',
  '0x1',
  '0x0',
  '0x2',
  '0x58623786b93d9b6ed1f83cec5c6fa6bea5f399d2795ee56a6123bdd83f5aa48',
  '0xd1b81feff3095ca9517fdfc7427e742ce96f7ca8f3b2664a21b2fba552493b',
  '0x5',
  '0x2',
  '0x0',
  '0x0',
  '0xb4fbf271143f5000000000000000000000000000',
  '0x3',
  '0x6',
  '0x64cce9272197eba6353f5bbf060e097e516b411e66e83a9cf5910a08697df14',
  '0x4112e7aef90c47058238ccb76bf79ad5188afdf366870015185e3c7468ccbd9',
  '0x68a2d3c6d882ec0e2e94042556878d27e832a28e1308df04ad35fd8bae9ec6b',
  '0x64bb9fd620d7e4c5f5895329e8f1d3d5f485ccfb2b16345a1ca86658f24c9f6',
  '0x59283b509832027a386b3f419628a5b149e9d6462a6547c63e92bd4a09a7245',
  '0x5e1f273ca9a11f78bfb291cbe1b49294cf3c76dd48951e7ab7db6d9fb1e7d62',
  '0x2',
  '0x4ecc83848a519cc22b0d0ffb70e65ec8dde85d3d13439eff7145d4063cf6b4d',
  '0x21dda40770f4317582251cffd5a0202d6b223dc167e5c8db25dc887d11eba81',
  '0x0'
];

export const voteCreatedEventData = [
  '0xf',
  '0xef8305e140ac520225daf050e2f71d5fbcc543e7',
  '0x1',
  '0x23cdb7dc255bf4da',
  '0x0'
];

export const spaceFactoryAbi = [
  {
    name: 'Uint256',
    size: 2,
    type: 'struct',
    members: [
      {
        name: 'low',
        type: 'felt',
        offset: 0
      },
      {
        name: 'high',
        type: 'felt',
        offset: 1
      }
    ]
  },
  {
    data: [
      {
        name: 'deployer_address',
        type: 'felt'
      },
      {
        name: 'space_address',
        type: 'felt'
      },
      {
        name: 'voting_delay',
        type: 'felt'
      },
      {
        name: 'min_voting_duration',
        type: 'felt'
      },
      {
        name: 'max_voting_duration',
        type: 'felt'
      },
      {
        name: 'proposal_threshold',
        type: 'Uint256'
      },
      {
        name: 'controller',
        type: 'felt'
      },
      {
        name: 'quorum',
        type: 'Uint256'
      },
      {
        name: 'voting_strategies_len',
        type: 'felt'
      },
      {
        name: 'voting_strategies',
        type: 'felt*'
      },
      {
        name: 'voting_strategy_params_flat_len',
        type: 'felt'
      },
      {
        name: 'voting_strategy_params_flat',
        type: 'felt*'
      },
      {
        name: 'authenticators_len',
        type: 'felt'
      },
      {
        name: 'authenticators',
        type: 'felt*'
      },
      {
        name: 'execution_strategies_len',
        type: 'felt'
      },
      {
        name: 'execution_strategies',
        type: 'felt*'
      },
      {
        name: 'metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'metadata_uri',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'space_deployed',
    type: 'event'
  },
  {
    name: 'constructor',
    type: 'constructor',
    inputs: [
      {
        name: 'space_class_hash',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'deploySpace',
    type: 'function',
    inputs: [
      {
        name: 'public_key',
        type: 'felt'
      },
      {
        name: 'voting_delay',
        type: 'felt'
      },
      {
        name: 'min_voting_duration',
        type: 'felt'
      },
      {
        name: 'max_voting_duration',
        type: 'felt'
      },
      {
        name: 'proposal_threshold',
        type: 'Uint256'
      },
      {
        name: 'controller',
        type: 'felt'
      },
      {
        name: 'quorum',
        type: 'Uint256'
      },
      {
        name: 'voting_strategies_len',
        type: 'felt'
      },
      {
        name: 'voting_strategies',
        type: 'felt*'
      },
      {
        name: 'voting_strategy_params_flat_len',
        type: 'felt'
      },
      {
        name: 'voting_strategy_params_flat',
        type: 'felt*'
      },
      {
        name: 'authenticators_len',
        type: 'felt'
      },
      {
        name: 'authenticators',
        type: 'felt*'
      },
      {
        name: 'execution_strategies_len',
        type: 'felt'
      },
      {
        name: 'execution_strategies',
        type: 'felt*'
      },
      {
        name: 'metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'metadata_uri',
        type: 'felt*'
      }
    ],
    outputs: []
  }
];

export const spaceAbi = [
  {
    name: 'Address',
    size: 1,
    type: 'struct',
    members: [
      {
        name: 'value',
        type: 'felt',
        offset: 0
      }
    ]
  },
  {
    name: 'Proposal',
    size: 5,
    type: 'struct',
    members: [
      {
        name: 'quorum',
        type: 'Uint256',
        offset: 0
      },
      {
        name: 'timestamps',
        type: 'felt',
        offset: 2
      },
      {
        name: 'execution_strategy',
        type: 'felt',
        offset: 3
      },
      {
        name: 'execution_hash',
        type: 'felt',
        offset: 4
      }
    ]
  },
  {
    name: 'Uint256',
    size: 2,
    type: 'struct',
    members: [
      {
        name: 'low',
        type: 'felt',
        offset: 0
      },
      {
        name: 'high',
        type: 'felt',
        offset: 1
      }
    ]
  },
  {
    name: 'Vote',
    size: 3,
    type: 'struct',
    members: [
      {
        name: 'choice',
        type: 'felt',
        offset: 0
      },
      {
        name: 'voting_power',
        type: 'Uint256',
        offset: 1
      }
    ]
  },
  {
    name: 'AccountCallArray',
    size: 4,
    type: 'struct',
    members: [
      {
        name: 'to',
        type: 'felt',
        offset: 0
      },
      {
        name: 'selector',
        type: 'felt',
        offset: 1
      },
      {
        name: 'data_offset',
        type: 'felt',
        offset: 2
      },
      {
        name: 'data_len',
        type: 'felt',
        offset: 3
      }
    ]
  },
  {
    name: 'ProposalInfo',
    size: 11,
    type: 'struct',
    members: [
      {
        name: 'proposal',
        type: 'Proposal',
        offset: 0
      },
      {
        name: 'power_for',
        type: 'Uint256',
        offset: 5
      },
      {
        name: 'power_against',
        type: 'Uint256',
        offset: 7
      },
      {
        name: 'power_abstain',
        type: 'Uint256',
        offset: 9
      }
    ]
  },
  {
    data: [
      {
        name: 'previousOwner',
        type: 'felt'
      },
      {
        name: 'newOwner',
        type: 'felt'
      }
    ],
    keys: [],
    name: 'OwnershipTransferred',
    type: 'event'
  },
  {
    data: [
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'proposer_address',
        type: 'Address'
      },
      {
        name: 'proposal',
        type: 'Proposal'
      },
      {
        name: 'metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'metadata_uri',
        type: 'felt*'
      },
      {
        name: 'execution_params_len',
        type: 'felt'
      },
      {
        name: 'execution_params',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'proposal_created',
    type: 'event'
  },
  {
    data: [
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'voter_address',
        type: 'Address'
      },
      {
        name: 'vote',
        type: 'Vote'
      }
    ],
    keys: [],
    name: 'vote_created',
    type: 'event'
  },
  {
    data: [
      {
        name: 'previous',
        type: 'Uint256'
      },
      {
        name: 'new_quorum',
        type: 'Uint256'
      }
    ],
    keys: [],
    name: 'quorum_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'previous',
        type: 'felt'
      },
      {
        name: 'new_voting_delay',
        type: 'felt'
      }
    ],
    keys: [],
    name: 'voting_delay_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'previous',
        type: 'felt'
      },
      {
        name: 'new_voting_duration',
        type: 'felt'
      }
    ],
    keys: [],
    name: 'min_voting_duration_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'previous',
        type: 'felt'
      },
      {
        name: 'new_voting_duration',
        type: 'felt'
      }
    ],
    keys: [],
    name: 'max_voting_duration_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'previous',
        type: 'Uint256'
      },
      {
        name: 'new_proposal_threshold',
        type: 'Uint256'
      }
    ],
    keys: [],
    name: 'proposal_threshold_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'new_metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'new_metadata_uri',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'metadata_uri_updated',
    type: 'event'
  },
  {
    data: [
      {
        name: 'added_len',
        type: 'felt'
      },
      {
        name: 'added',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'authenticators_added',
    type: 'event'
  },
  {
    data: [
      {
        name: 'removed_len',
        type: 'felt'
      },
      {
        name: 'removed',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'authenticators_removed',
    type: 'event'
  },
  {
    data: [
      {
        name: 'added_len',
        type: 'felt'
      },
      {
        name: 'added',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'execution_strategies_added',
    type: 'event'
  },
  {
    data: [
      {
        name: 'removed_len',
        type: 'felt'
      },
      {
        name: 'removed',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'execution_strategies_removed',
    type: 'event'
  },
  {
    data: [
      {
        name: 'added_len',
        type: 'felt'
      },
      {
        name: 'added',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'voting_strategies_added',
    type: 'event'
  },
  {
    data: [
      {
        name: 'removed_len',
        type: 'felt'
      },
      {
        name: 'removed',
        type: 'felt*'
      }
    ],
    keys: [],
    name: 'voting_strategies_removed',
    type: 'event'
  },
  {
    name: 'constructor',
    type: 'constructor',
    inputs: [
      {
        name: 'public_key',
        type: 'felt'
      },
      {
        name: 'voting_delay',
        type: 'felt'
      },
      {
        name: 'min_voting_duration',
        type: 'felt'
      },
      {
        name: 'max_voting_duration',
        type: 'felt'
      },
      {
        name: 'proposal_threshold',
        type: 'Uint256'
      },
      {
        name: 'controller',
        type: 'felt'
      },
      {
        name: 'quorum',
        type: 'Uint256'
      },
      {
        name: 'voting_strategies_len',
        type: 'felt'
      },
      {
        name: 'voting_strategies',
        type: 'felt*'
      },
      {
        name: 'voting_strategy_params_flat_len',
        type: 'felt'
      },
      {
        name: 'voting_strategy_params_flat',
        type: 'felt*'
      },
      {
        name: 'authenticators_len',
        type: 'felt'
      },
      {
        name: 'authenticators',
        type: 'felt*'
      },
      {
        name: 'execution_strategies_len',
        type: 'felt'
      },
      {
        name: 'execution_strategies',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'getPublicKey',
    type: 'function',
    inputs: [],
    outputs: [
      {
        name: 'publicKey',
        type: 'felt'
      }
    ],
    stateMutability: 'view'
  },
  {
    name: 'supportsInterface',
    type: 'function',
    inputs: [
      {
        name: 'interfaceId',
        type: 'felt'
      }
    ],
    outputs: [
      {
        name: 'success',
        type: 'felt'
      }
    ],
    stateMutability: 'view'
  },
  {
    name: 'setPublicKey',
    type: 'function',
    inputs: [
      {
        name: 'newPublicKey',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'isValidSignature',
    type: 'function',
    inputs: [
      {
        name: 'hash',
        type: 'felt'
      },
      {
        name: 'signature_len',
        type: 'felt'
      },
      {
        name: 'signature',
        type: 'felt*'
      }
    ],
    outputs: [
      {
        name: 'isValid',
        type: 'felt'
      }
    ],
    stateMutability: 'view'
  },
  {
    name: '__validate__',
    type: 'function',
    inputs: [
      {
        name: 'call_array_len',
        type: 'felt'
      },
      {
        name: 'call_array',
        type: 'AccountCallArray*'
      },
      {
        name: 'calldata_len',
        type: 'felt'
      },
      {
        name: 'calldata',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: '__validate_declare__',
    type: 'function',
    inputs: [
      {
        name: 'class_hash',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: '__validate_deploy__',
    type: 'function',
    inputs: [
      {
        name: 'class_hash',
        type: 'felt'
      },
      {
        name: 'salt',
        type: 'felt'
      },
      {
        name: 'publicKey',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: '__execute__',
    type: 'function',
    inputs: [
      {
        name: 'call_array_len',
        type: 'felt'
      },
      {
        name: 'call_array',
        type: 'AccountCallArray*'
      },
      {
        name: 'calldata_len',
        type: 'felt'
      },
      {
        name: 'calldata',
        type: 'felt*'
      }
    ],
    outputs: [
      {
        name: 'response_len',
        type: 'felt'
      },
      {
        name: 'response',
        type: 'felt*'
      }
    ]
  },
  {
    name: 'propose',
    type: 'function',
    inputs: [
      {
        name: 'proposer_address',
        type: 'Address'
      },
      {
        name: 'metadata_uri_string_len',
        type: 'felt'
      },
      {
        name: 'metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'metadata_uri',
        type: 'felt*'
      },
      {
        name: 'execution_strategy',
        type: 'felt'
      },
      {
        name: 'used_voting_strategies_len',
        type: 'felt'
      },
      {
        name: 'used_voting_strategies',
        type: 'felt*'
      },
      {
        name: 'user_voting_strategy_params_flat_len',
        type: 'felt'
      },
      {
        name: 'user_voting_strategy_params_flat',
        type: 'felt*'
      },
      {
        name: 'execution_params_len',
        type: 'felt'
      },
      {
        name: 'execution_params',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'vote',
    type: 'function',
    inputs: [
      {
        name: 'voter_address',
        type: 'Address'
      },
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'choice',
        type: 'felt'
      },
      {
        name: 'used_voting_strategies_len',
        type: 'felt'
      },
      {
        name: 'used_voting_strategies',
        type: 'felt*'
      },
      {
        name: 'user_voting_strategy_params_flat_len',
        type: 'felt'
      },
      {
        name: 'user_voting_strategy_params_flat',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'finalizeProposal',
    type: 'function',
    inputs: [
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'execution_params_len',
        type: 'felt'
      },
      {
        name: 'execution_params',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'cancelProposal',
    type: 'function',
    inputs: [
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'execution_params_len',
        type: 'felt'
      },
      {
        name: 'execution_params',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'hasVoted',
    type: 'function',
    inputs: [
      {
        name: 'proposal_id',
        type: 'felt'
      },
      {
        name: 'voter_address',
        type: 'Address'
      }
    ],
    outputs: [
      {
        name: 'voted',
        type: 'felt'
      }
    ],
    stateMutability: 'view'
  },
  {
    name: 'getProposalInfo',
    type: 'function',
    inputs: [
      {
        name: 'proposal_id',
        type: 'felt'
      }
    ],
    outputs: [
      {
        name: 'proposal_info',
        type: 'ProposalInfo'
      }
    ],
    stateMutability: 'view'
  },
  {
    name: 'setController',
    type: 'function',
    inputs: [
      {
        name: 'new_controller',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'setQuorum',
    type: 'function',
    inputs: [
      {
        name: 'new_quorum',
        type: 'Uint256'
      }
    ],
    outputs: []
  },
  {
    name: 'setVotingDelay',
    type: 'function',
    inputs: [
      {
        name: 'new_delay',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'setMinVotingDuration',
    type: 'function',
    inputs: [
      {
        name: 'new_min_voting_duration',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'setMaxVotingDuration',
    type: 'function',
    inputs: [
      {
        name: 'new_max_voting_duration',
        type: 'felt'
      }
    ],
    outputs: []
  },
  {
    name: 'setProposalThreshold',
    type: 'function',
    inputs: [
      {
        name: 'new_proposal_threshold',
        type: 'Uint256'
      }
    ],
    outputs: []
  },
  {
    name: 'setMetadataUri',
    type: 'function',
    inputs: [
      {
        name: 'new_metadata_uri_len',
        type: 'felt'
      },
      {
        name: 'new_metadata_uri',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'addExecutionStrategies',
    type: 'function',
    inputs: [
      {
        name: 'addresses_len',
        type: 'felt'
      },
      {
        name: 'addresses',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'removeExecutionStrategies',
    type: 'function',
    inputs: [
      {
        name: 'addresses_len',
        type: 'felt'
      },
      {
        name: 'addresses',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'addVotingStrategies',
    type: 'function',
    inputs: [
      {
        name: 'addresses_len',
        type: 'felt'
      },
      {
        name: 'addresses',
        type: 'felt*'
      },
      {
        name: 'params_flat_len',
        type: 'felt'
      },
      {
        name: 'params_flat',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'removeVotingStrategies',
    type: 'function',
    inputs: [
      {
        name: 'indexes_len',
        type: 'felt'
      },
      {
        name: 'indexes',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'addAuthenticators',
    type: 'function',
    inputs: [
      {
        name: 'addresses_len',
        type: 'felt'
      },
      {
        name: 'addresses',
        type: 'felt*'
      }
    ],
    outputs: []
  },
  {
    name: 'removeAuthenticators',
    type: 'function',
    inputs: [
      {
        name: 'addresses_len',
        type: 'felt'
      },
      {
        name: 'addresses',
        type: 'felt*'
      }
    ],
    outputs: []
  }
];
