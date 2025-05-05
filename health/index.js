// api/health/index.js
module.exports = async function (context, req) {
  const currentTime = new Date();

  // You can add actual health checks here
  const isHealthy = true; // Replace with your logic to check database, external services, etc.

  let status = 'Healthy';
  let message = 'API is operating normally.';
  let details = {
      timestamp: currentTime.toISOString(),
      // Add other relevant details here, e.g., database connection status
      // databaseStatus: 'Connected',
      // serviceXStatus: 'Operational'
  };

  if (!isHealthy) {
      status = 'Unhealthy';
      message = 'API is experiencing issues.';
      // Add more specific error details if possible
      // details.error = 'Database connection failed';
  }

  context.res = {
      // Status code defaults to 200 OK if not set, which is fine for a healthy status
      // If unhealthy, you might return a different status code like 503 Service Unavailable
      // status: isHealthy ? 200 : 503,
      headers: {
          "Content-Type": "application/json"
      },
      body: {
          status: status,
          message: message,
          details: details
      }
  };

  // If you wanted to return a non-200 status code for unhealthy:
  // if (!isHealthy) {
  //     context.res.status = 503;
  // }
};