export const validCheckpointConfig = {
  network: 'goerli-alpha',
  sources: [
    {
      contract: '0x0625dc1290b6e936be5f1a3e963cf629326b1f4dfd5a56738dea98e1ad31b7f3',
      start: 112319,
      deploy_fn: 'handleDeploy',
      events: [
        {
          name: 'proposal_created',
          fn: 'handlePropose'
        },
        {
          name: 'vote_created',
          fn: 'handleVote'
        }
      ]
    }
  ]
};
