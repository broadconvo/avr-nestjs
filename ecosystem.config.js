// This file is used to configure the PM2 process manager
module.exports = {
  apps: [
    {
      name: "avr-nestjs-english",           // Unique name for this instance
      script: "npm",                 // Command to execute
      args: "run start",              // Arguments to pass to the script
      env: {
        ENV_FILE: ".env.english" // Path to the custom .env file
      }
    },
    {
      name: "avr-nestjs-chinese",           // Unique name for this instance
      script: "npm",                 // Command to execute
      args: "run start",              // Arguments to pass to the script
      env: {
        ENV_FILE: ".env.chinese" // Path to the custom .env file
      }
    },
    {
      name: "avr-nestjs-thai",           // Unique name for this instance
      script: "npm",                 // Command to execute
      args: "run start",              // Arguments to pass to the script
      env: {
        ENV_FILE: ".env.thai" // Path to the custom .env file
      }
    },
  ]
};
