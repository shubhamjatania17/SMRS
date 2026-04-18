const { handleApiRequest } = require('../lib/smrs-serverless');

module.exports = async function handler(req, res) {
  return handleApiRequest(req, res);
};