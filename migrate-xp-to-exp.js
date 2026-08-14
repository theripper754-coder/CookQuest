const mongoose = require('mongoose');
const dns = require('dns');
const User = require('./serializer/user');

const mongoURI = 'mongodb+srv://CookQuestProject:3xmBT5S7w2Y054b0@cluster0.zz1bawk.mongodb.net/CookQuest?appName=Cluster0';
const mongoURIDirect = 'mongodb://CookQuestProject:3xmBT5S7w2Y054b0@cluster0-shard-00-00.zz1bawk.mongodb.net:27017,cluster0-shard-00-01.zz1bawk.mongodb.net:27017,cluster0-shard-00-02.zz1bawk.mongodb.net:27017/CookQuest?ssl=true&replicaSet=atlas-u49f87-shard-0&authSource=admin&retryWrites=true&w=majority';

// Match server.js behavior to avoid local DNS resolver issues.
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function runMigration() {
  try {
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  } catch (srvError) {
    console.warn('SRV connection failed, retrying with direct hosts...');
    console.warn(srvError.message);
    await mongoose.connect(mongoURIDirect, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }

  console.log('Connected to MongoDB');

  // Copy xp -> exp only when exp is missing
  const result = await User.updateMany(
    {
      exp: { $exists: false },
      xp: { $exists: true },
    },
    [
      {
        $set: {
          exp: '$xp',
        },
      },
    ]
  );

  // Optional cleanup: remove old xp after copy
  const unsetResult = await User.updateMany(
    { xp: { $exists: true } },
    { $unset: { xp: '' } }
  );

  console.log(`Users copied from xp -> exp: ${result.modifiedCount}`);
  console.log(`Users cleaned old xp field: ${unsetResult.modifiedCount}`);
}

runMigration()
  .then(async () => {
    console.log('Migration completed successfully');
    await mongoose.connection.close();
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  });
