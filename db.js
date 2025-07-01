const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Transcript = require("./model/Transcript"); // Adjust the path to your Transcript model
dotenv.config();

const connectDB = () => {
    console.log('Attempting to connect to MongoDB at:', process.env.MONGODB_URL || 'MongoDB URL not found');
    
    const options = {
        serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    };
    
    mongoose.connect(process.env.MONGODB_URL, options)
    .then(() => {
        console.log("Connected to the database successfully!");
        // Create TTL index for the Transcript collection
        Transcript.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
            .then(() => console.log("TTL index created for Transcript collection"))
            .catch(err => console.error("Error creating TTL index:", err));
    })
    .catch((error) => {
        console.error("Database connection error:", error);
        console.log("MongoDB connection failed. If you don't have MongoDB setup, you may want to create a .env file with a valid MONGODB_URL or use the file-based fallback.");
    });
    
    // Log when the connection is disconnected
    mongoose.connection.on('disconnected', () => {
        console.log('MongoDB disconnected');
    });
    
    // Log when the connection is reconnected
    mongoose.connection.on('reconnected', () => {
        console.log('MongoDB reconnected');
    });
    
    // Handle errors after initial connection
    mongoose.connection.on('error', (err) => {
        console.error('MongoDB error:', err);
    });
}

exports.connectDB = connectDB;