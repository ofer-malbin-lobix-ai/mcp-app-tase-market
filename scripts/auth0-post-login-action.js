/**
 * Auth0 Post-Login Action: Add Email to Access Token
 *
 * Injects the user's email into the access token so the MCP server
 * can use it for user identification.
 *
 * Setup in Auth0 Dashboard:
 * 1. Go to Actions → Flows → Login
 * 2. Create a new custom action with this code
 * 3. Deploy and add to the Login flow
 */
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://tase-market.mcp-apps.lobix.ai';

  if (event.user.email) {
    api.accessToken.setCustomClaim(`${namespace}/email`, event.user.email);
  }
};
