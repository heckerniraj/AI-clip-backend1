const mongoose = require("mongoose");

const usersSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    profilePicture: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    isAdmin: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    savedVideos: [{ type: mongoose.Schema.Types.ObjectId, ref: "Video" }],
    likedVideos: [{ type: mongoose.Schema.Types.ObjectId, ref: "PublishedVideo" }],
    publishedVideos: [{ type: mongoose.Schema.Types.ObjectId, ref: "PublishedVideo" }],
    
    // Auth provider fields
    authProvider: { type: String, enum: ['local', 'google', 'github', 'twitter'], default: 'local' },
    isGoogleUser: { type: Boolean, default: false },
    isGithubUser: { type: Boolean, default: false },
    isTwitterUser: { type: Boolean, default: false },
    
    // OAuth provider specific fields
    googleId: { type: String },
    githubId: { type: String },
    twitterId: { type: String },
    
    // For account recovery
    passwordResetToken: { type: String },
    passwordResetExpires: { type: Date }
});

module.exports = mongoose.model("User", usersSchema);
