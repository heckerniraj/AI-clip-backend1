const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const { axiosWithProxy } = require("../utils/axiosWithProxy");
const User = require("../model/usersSchema");
const jwt = require("jsonwebtoken");
const dotenv = require('dotenv');
dotenv.config();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const signinUserWithPassword = async (req, res) => {
  try {
    // Validate request data
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        status: false, 
        message: "Email and password are required" 
      });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
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
    
    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
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
    
    // Return user data (excluding sensitive information)
    res.status(200).json({ 
      status: true,
      message: "User signed in successfully", 
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
    console.error("Signin error:", err);
    res.status(500).json({ 
      status: false,
      message: "Internal server error", 
      error: err.message 
    });
  }
};

const signinUserWithGoogle = async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        status: false,
        message: "Google token is required"
      });
    }
    
    // Verify the Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const { email, name, picture, sub } = ticket.getPayload();
    
    // Check if user exists
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user with Google info if they haven't used Google before
      if (!user.isGoogleUser) {
        user.isGoogleUser = true;
        user.googleId = sub;
        user.authProvider = 'google';
        if (!user.profilePicture && picture) {
          user.profilePicture = picture;
        }
        await user.save();
      }
    } else {
      // Create new user
      user = new User({ 
        email, 
        name, 
        profilePicture: picture,
        isGoogleUser: true,
        googleId: sub,
        authProvider: 'google'
      });
      await user.save();
    }
    
    // Generate JWT token
    const jwtToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your_jwt_secret_key",
      { expiresIn: "24h" }
    );
    
    // Return user data
    res.status(200).json({ 
      status: true,
      message: "User signed in successfully", 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        profilePicture: user.profilePicture,
        authProvider: user.authProvider
      },
      token: jwtToken 
    });
  } catch (err) {
    console.error("Google signin error:", err);
    res.status(500).json({ 
      status: false,
      message: "Google authentication failed", 
      error: err.message 
    });
  }
};

const signinUserWithGithub = async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        status: false,
        message: "Authorization code is required"
      });
    }
    
    // Exchange code for access token - using standard axiosWithProxy (which is now just regular axios)
    const tokenResponse = await axiosWithProxy.post('https://github.com/login/oauth/access_token', {
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: code
    }, {
      headers: {
        Accept: 'application/json'
      }
    });
    
    if (!tokenResponse.data.access_token) {
      return res.status(400).json({
        status: false,
        message: "Failed to obtain access token from GitHub"
      });
    }
    
    // Get user info from GitHub - using standard axiosWithProxy (which is now just regular axios)
    const userResponse = await axiosWithProxy.get('https://api.github.com/user', {
      headers: {
        Authorization: `token ${tokenResponse.data.access_token}`
      }
    });
    
    // GitHub doesn't always return email, so we need to fetch emails separately
    // using standard axiosWithProxy (which is now just regular axios)
    const emailsResponse = await axiosWithProxy.get('https://api.github.com/user/emails', {
      headers: {
        Authorization: `token ${tokenResponse.data.access_token}`
      }
    });
    
    // Get user's email if not provided in the user data
    let email = userResponse.data.email;
    if (!email) {
      // Find the primary email
      const primaryEmail = emailsResponse.data.find(email => email.primary);
      email = primaryEmail ? primaryEmail.email : emailsResponse.data[0].email;
    }

    if (!email) {
      return res.status(400).json({
        status: false,
        message: "Could not retrieve email from GitHub"
      });
    }

    const { id, name, login, avatar_url } = userResponse.data;
    const githubName = name || login;

    // Find or create user
    let user = await User.findOne({ email });

    if (user) {
      // Update existing user with GitHub info
      if (!user.isGithubUser) {
        user.isGithubUser = true;
        user.githubId = id.toString();
        user.authProvider = 'github';
        if (!user.profilePicture && avatar_url) {
          user.profilePicture = avatar_url;
        }
        await user.save();
      }
    } else {
      // Create new user
      user = new User({
        email,
        name: githubName,
        profilePicture: avatar_url,
        isGithubUser: true,
        githubId: id.toString(),
        authProvider: 'github'
      });
      await user.save();
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your_jwt_secret_key",
      { expiresIn: "24h" }
    );
    
    // Return user data
    res.status(200).json({ 
      status: true,
      message: "User signed in successfully", 
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
  } catch (error) {
    console.error("GitHub auth error:", error);
    res.status(500).json({
      status: false,
      message: "Authentication with GitHub failed"
    });
  }
};

const signinUserWithTwitter = async (req, res) => {
  try {
    const { oauth_token, oauth_verifier } = req.body;
    
    if (!oauth_token || !oauth_verifier) {
      return res.status(400).json({
        status: false,
        message: "OAuth token and verifier are required"
      });
    }
    
    // Exchange request token for access token with proper OAuth 1.0a headers
    const tokenResponse = await axiosWithProxy.post(
      'https://api.twitter.com/oauth/access_token',
      null,
      {
        params: {
          oauth_token,
          oauth_verifier,
          oauth_consumer_key: process.env.TWITTER_CONSUMER_KEY
        },
        headers: {
          Authorization: `OAuth oauth_consumer_key="${process.env.TWITTER_CONSUMER_KEY}"`
        }
      }
    );

    // Parse the response (it comes as a query string)
    const responseData = tokenResponse.data;
    const parsedData = {};
    responseData.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      parsedData[key] = decodeURIComponent(value);
    });

    const { oauth_token: accessToken, oauth_token_secret: accessTokenSecret, user_id: id, screen_name: username } = parsedData;
    
    if (!accessToken || !id) {
      return res.status(401).json({
        status: false,
        message: "Failed to obtain Twitter access token"
      });
    }

    // Get user info from Twitter API v1.1 (more reliable for OAuth 1.0a)
    const userResponse = await axiosWithProxy.get(
      'https://api.twitter.com/1.1/users/show.json',
      {
        params: {
          user_id: id
        },
        headers: {
          Authorization: `OAuth oauth_consumer_key="${process.env.TWITTER_CONSUMER_KEY}", oauth_token="${accessToken}"`
        }
      }
    );

    const { name, profile_image_url_https } = userResponse.data;
    
    // Generate a more unique email since Twitter doesn't provide one
    const email = `twitter-${id}@${process.env.EMAIL_DOMAIN || 'https://clip-frontend-three.vercel.app/'}`;
    const profilePicture = profile_image_url_https?.replace('_normal', ''); // Get higher res image

    // Find or create user
    let user = await User.findOne({ $or: [{ email }, { twitterId: id }] });

    if (user) {
      // Update existing user with Twitter info
      if (!user.isTwitterUser) {
        user.isTwitterUser = true;
        user.twitterId = id;
        user.authProvider = 'twitter';
        if (!user.profilePicture && profilePicture) {
          user.profilePicture = profilePicture;
        }
        await user.save();
      }
    } else {
      // Create new user
      user = new User({
        email,
        name: name || username,
        profilePicture: profilePicture,
        isTwitterUser: true,
        twitterId: id,
        authProvider: 'twitter',
        emailVerified: false // Mark Twitter emails as unverified
      });
      await user.save();
    }

    // Generate JWT token with stronger algorithm
    const token = jwt.sign(
      { 
        userId: user._id, 
        email: user.email,
        authProvider: user.authProvider
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: "24h",
        algorithm: 'HS256'
      }
    );
    
    // Return user data
    res.status(200).json({ 
      status: true,
      message: "User signed in successfully", 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        profilePicture: user.profilePicture,
        authProvider: user.authProvider,
        emailVerified: user.emailVerified
      },
      token 
    });
  } catch (error) {
    console.error("Twitter auth error:", error);
    const errorMessage = error.response?.data?.errors?.[0]?.message || 
                        error.response?.data?.message || 
                        "Authentication with Twitter failed";
    
    res.status(500).json({
      status: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  signinUserWithPassword,
  signinUserWithGoogle,
  signinUserWithGithub,
  signinUserWithTwitter
};
