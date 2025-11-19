const path = require('path');
const testConfig = require('./testConfig');

function generateUserSetupProjects() {
  const allUsers = testConfig.getAllUsers();
  
  return allUsers.map((user, index) => {
    const userIndex = index + 1;
    return {
      name: `setup-user-${userIndex}`,
      testMatch: /auth\/user\.setup\.js/,
      grep: new RegExp(`authenticate user ${userIndex}`),
    };
  });
}

function generateUserProjects() {
  const allUsers = testConfig.getAllUsers();
  
  return allUsers.map((user, index) => {
    const userIndex = index + 1;
    return {
      name: `user-${userIndex}`,
      use: {
        storageState: path.join(__dirname, `../.auth/user-${userIndex}.json`),
      },
      dependencies: [`setup-user-${userIndex}`],
    };
  });
}

module.exports = {
  generateUserSetupProjects,
  generateUserProjects,
};
