const User = require("../../model/usersSchema");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const loginUser = async (req, res) => {
    try {
        // Validate request data
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                status: false, 
                message: "Email and password are required" 
            });
        }
        
        console.log("Login attempt:", { email });
        
        // Find user by email
        const user = await User.findOne({ email });
        if (!user) {
            console.log("User not found:", email);
            return res.status(401).json({ 
                status: false, 
                message: "Invalid email or password" 
            });
        }
        
        // Check if user used OAuth and doesn't have a password
        if (user.authProvider !== 'local' && !user.password) {
            const provider = user.authProvider.charAt(0).toUpperCase() + user.authProvider.slice(1);
            return res.status(401).json({
                status: false,
                message: `This account uses ${provider} authentication. Please sign in with ${provider}.`
            });
        }
        
        // Check if password exists
        if (!user.password) {
            console.log("No password field found for user");
            return res.status(401).json({
                status: false,
                message: "Account setup incomplete. Please use the password reset feature."
            });
        }
        
        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        console.log("Password comparison result:", isMatch);
        
        if (!isMatch) {
            return res.status(401).json({ 
                status: false, 
                message: "Invalid email or password" 
            });
        }
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || "your_jwt_secret_key",
            { expiresIn: "24h" }
        );
        
        // Return user info and token (excluding sensitive data)
        res.status(200).json({
            status: true,
            message: "Login successful",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                profilePicture: user.profilePicture,
                authProvider: user.authProvider
            },
            token
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ 
            status: false, 
            message: "Login failed", 
            error: err.message 
        });
    }
};

module.exports = loginUser; 