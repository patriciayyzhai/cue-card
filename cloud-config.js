/* Public cloud config for this app, copied verbatim from the cloud-service publicConfig
   returned when the environment was activated. Safe to ship in front-end code:
   publishableKey identifies the app and carries no permissions by itself (the server enforces
   an exact Origin match). Never add secrets here. */
window.CUECARD_CLOUD_CONFIG = {
  endpoint: 'https://cue-card.app-tencent.workbuddy.host',
  publishableKey: 'wbpk_hzKEjjv3BBPJx4RF6kOzr4_5lsiTXtXmgSA6pi92e11y24z2l8WpwYY',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'
};
