const mongoose = require('mongoose');
const User = require('../model/usersSchema');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clipsmartai')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

async function migratePasswords() {
  try {
    const users = await User.find({
      password: { $exists: true, $ne: null },
      $or: [
        { hashedPassword: { $exists: false } },
        { hashedPassword: null }
      ]
    });

    console.log(`Found ${users.length} users to migrate`);

    for (const user of users) {
      console.log(`Migrating user: ${user.email}`);
      
      user.hashedPassword = user.password;
      await user.save();
      
      console.log(`Migrated user: ${user.email}`);
    }

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migratePasswords(); 