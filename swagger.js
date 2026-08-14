const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');

module.exports = (app, port) => {
  try {
    const swaggerDocument = YAML.load(path.join(__dirname, './swagger.yaml'));
    if (swaggerDocument.servers && swaggerDocument.servers[0]) {
      swaggerDocument.servers[0].url = `http://localhost:${port || 4000}/api`;
    }
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  } catch (error) {
    console.error('⚠ Failed to load swagger.yaml:', error.message);
  }
};