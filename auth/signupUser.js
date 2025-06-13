const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../model/usersSchema");

const signupUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Input validation
        if (!name || !email || !password) {
            return res.status(400).json({
                status: false,
                message: "All fields are required"
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: false,
                message: "Please provide a valid email address"
            });
        }

        // Password strength validation
        if (password.length < 6) {
            return res.status(400).json({
                status: false,
                message: "Password must be at least 6 characters long"
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                status: false,
                message: "User with this email already exists"
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const user = new User({
            name,
            email,
            password: hashedPassword,
            authProvider: 'local'
        });

        // Save user
        await user.save();

        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET || "your_jwt_secret_key",
            { expiresIn: "24h" }
        );

        // Return success response (excluding sensitive data)
        res.status(201).json({
            status: true,
            message: "User registered successfully",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                authProvider: user.authProvider
            },
            token
        });
    } catch (err) {
        console.error("Signup error:", err);
        res.status(500).json({
            status: false,
            message: "Registration failed",
            error: err.message
        });
    }
};

module.exports = signupUser;