const User = require("../../model/usersSchema");
const bcrypt = require("bcrypt");

const addUser = async (req, res) => {
    try{
        const { name, email, password } = req.body;
        
        console.log("Registration attempt:", { name, email });
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log("User already exists:", email);
            return res.status(400).json({ 
                status: false, 
                message: "Email already in use" 
            });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log("Password hashed successfully");
        
        // Create user with consistent password field names
        const user = await User.create({ 
            name, 
            email, 
            hashedPassword  // Store as hashedPassword to be consistent with login
        });
        
        console.log("User created successfully:", user._id);
        
        // Return user without password
        const userResponse = {
            _id: user._id,
            name: user.name,
            email: user.email
        };
        
        res.status(201).json({ 
            status: true, 
            message: "User created successfully", 
            user: userResponse 
        });
    }
    catch(err){
        console.error("Registration error:", err);
        res.status(500).json({ 
            status: false, 
            message: "Failed to create user", 
            error: err.message 
        });
    }
};

module.exports = addUser;