const mongoose = require('mongoose');
const mongoURI = 'mongodb+srv://CookQuestProject:3xmBT5S7w2Y054b0@cluster0.zz1bawk.mongodb.net/CookQuest?appName=Cluster0';

mongoose.connect(mongoURI)
.then(async () => {
  console.log('Connected to MongoDB');
  const db = mongoose.connection.db;
  const collection = db.collection('users');
  const docs = await collection.find({}).toArray();
  console.log(`Found ${docs.length} users`);
  docs.forEach(doc => {
    console.log(`ID: ${doc._id}, Username: ${doc.username}, Email: ${doc.email}, EXP: ${doc.exp || 0}, Level: ${doc.level}, Rank: ${doc.rank}`);
  });
  mongoose.connection.close();
})
.catch(err => {
  console.error(err);
});
