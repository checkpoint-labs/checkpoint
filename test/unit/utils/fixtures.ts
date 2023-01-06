export const spaceDeployedEventFormat = [
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
] as const;

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
