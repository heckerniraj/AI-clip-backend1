const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Project = require('../model/projectSchema');
const PublishedVideo = require('../model/publishedVideosSchema');
const mongoose = require('mongoose');
const s3 = require('../config/s3');

// Get all projects for a user
const getUserProjects = async (req, res) => {
  try {
    // Fetch from the database using the user's ID
    const userId = req.user.id;
    
    // Find projects for the user in the database
    const projects = await Project.find({ userId }).sort({ createdAt: -1 });
    
    // If no database projects, fall back to file system
    if (!projects || projects.length === 0) {
      const fileProjects = await getUserProjectsFromFileSystem();
      return res.status(200).json({
        success: true,
        projects: fileProjects
      });
    }
    
    return res.status(200).json({
      success: true,
      projects
    });
    
  } catch (error) {
    console.error('Error fetching user projects:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching projects',
      error: error.message
    });
  }
};

// Helper function to safely handle ID conversion for MongoDB
const safeObjectId = (id) => {
  if (mongoose.Types.ObjectId.isValid(id)) {
    return new mongoose.Types.ObjectId(id);
  }
  return id;
};

// Create a new project
const createProject = async (req, res) => {
  try {
    console.log('Project creation request received:', JSON.stringify({
      requestBody: req.body,
      userId: req.user ? req.user.id : 'No user ID found',
      headers: req.headers
    }, null, 2));

    const {
      title,
      description,
      jobId,
      duration,
      s3Url,
      thumbnailUrl,
      userEmail,
      userName,
      aiSummary,
      sourceClips,
      stats,
      userId = req.user ? req.user.id : null
    } = req.body;

    if (!title || !s3Url) {
      console.log('Missing required fields:', { title, s3Url });
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: title and s3Url are required'
      });
    }

    // Determine userId with fallbacks
    let effectiveUserId = null;
    
    if (req.user && req.user.id) {
      effectiveUserId = req.user.id;
      console.log('Using authenticated user ID:', effectiveUserId);
    } else if (userId) {
      effectiveUserId = userId;
      console.log('Using userId from request body:', effectiveUserId);
    } else {

      effectiveUserId = 'guest_' + Math.random().toString(36).substring(2, 15);
      console.log('Created guest user ID:', effectiveUserId);
    }

    try {
      console.log('Creating published video with data:', {
        userId: effectiveUserId,
        title,
        description: description ? description.substring(0, 30) + '...' : 'None',
        videoUrl: s3Url ? s3Url.substring(0, 30) + '...' : 'None',
        thumbnailUrl: thumbnailUrl ? thumbnailUrl.substring(0, 30) + '...' : 'None'
      });

      // First, create a published video entry
      const publishedVideo = await PublishedVideo.create({
        userId: effectiveUserId, // Now handled by the schema
        title,
        description,
        videoUrl: s3Url,
        thumbnailUrl: thumbnailUrl || ''
      });
      
      console.log('Published video created successfully:', publishedVideo._id.toString());

      console.log('Creating project with data:', {
        userId: effectiveUserId,
        title,
        jobId,
        s3Url: s3Url ? s3Url.substring(0, 30) + '...' : 'None'
      });

      // Then create the project with a reference to the published video
      const project = await Project.create({
        userId: effectiveUserId, // Now handled by the schema
        title,
        description,
        jobId,
        duration,
        s3Url,
        thumbnailUrl,
        userEmail,
        userName,
        aiSummary,
        sourceClips,
        stats,
        publishedVideoId: publishedVideo._id
      });
      
      console.log('Project created successfully:', project._id.toString());

      // Update the published video with a reference to the project
      await PublishedVideo.findByIdAndUpdate(
        publishedVideo._id,
        { projectId: project._id }
      );
      
      console.log('Updated published video with project reference');

      // If the userId is a valid ObjectId, attempt to update the user's publishedVideos array
      if (mongoose.Types.ObjectId.isValid(effectiveUserId)) {
        try {
          await mongoose.model('User').findByIdAndUpdate(
            effectiveUserId,
            { $push: { publishedVideos: publishedVideo._id } }
          );
          console.log('Updated user publishedVideos array');
        } catch (userUpdateError) {
          console.error('Error updating user publishedVideos array:', userUpdateError);
          // Continue even if this update fails
        }
      } else {
        console.log('Skipping user update as userId is not a valid ObjectId:', effectiveUserId);
      }

      return res.status(201).json({
        success: true,
        message: 'Project created successfully',
        project,
        publishedVideo
      });
    } catch (dbError) {
      console.error('Database operation failed:', dbError);
      // Check for MongoDB duplicate key error
      if (dbError.code === 11000) { // MongoDB duplicate key error code
        return res.status(409).json({
          success: false,
          message: 'A project with this information already exists',
          error: 'Duplicate entry',
          details: dbError.keyValue
        });
      }
      
      // Provide more detailed error information
      return res.status(500).json({
        success: false,
        message: 'Database operation failed',
        error: dbError.message,
        code: dbError.code,
        stack: process.env.NODE_ENV === 'production' ? null : dbError.stack
      });
    }
  } catch (error) {
    console.error('Error creating project:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating project',
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? null : error.stack
    });
  }
};

// Delete a project
const deleteProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id; // Get user ID from auth middleware

    // Find the project and ensure it belongs to the user
    const project = await Project.findOne({ _id: projectId, user: userId });
    
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found or you do not have permission to delete it'
      });
    }

    // Delete associated files from S3 if they exist
    if (project.s3Url) {
      try {
        const s3Key = project.s3Url.split('/').pop(); // Get the file name from URL
        await s3.deleteObject({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: s3Key
        }).promise();
      } catch (s3Error) {
        console.error('Error deleting file from S3:', s3Error);
        // Continue with project deletion even if S3 deletion fails
      }
    }

    // Delete any associated clips
    if (project.sourceClips && project.sourceClips.length > 0) {
      // Delete each clip's data if stored separately
      for (const clip of project.sourceClips) {
        if (clip.s3Url) {
          try {
            const clipS3Key = clip.s3Url.split('/').pop();
            await s3.deleteObject({
              Bucket: process.env.AWS_S3_BUCKET,
              Key: clipS3Key
            }).promise();
          } catch (clipError) {
            console.error('Error deleting clip from S3:', clipError);
          }
        }
      }
    }

    // Delete the project from the database
    await Project.findByIdAndDelete(projectId);

    return res.status(200).json({
      success: true,
      message: 'Project and associated files deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting project:', error);
    return res.status(500).json({
      success: false,
      message: 'Error deleting project',
      error: error.message
    });
  }
};

// Helper function to get projects from file system
const getUserProjectsFromFileSystem = async () => {
  // Create a list of all job directories from the temp folder
  const tempDir = path.join(__dirname, '../temp');
  
  // Check if temp directory exists
  if (!fs.existsSync(tempDir)) {
    return [];
  }
  
  // Get all job directories
  const jobDirs = fs.readdirSync(tempDir).filter(dir => {
    const jobDir = path.join(tempDir, dir);
    return fs.statSync(jobDir).isDirectory();
  });
  
  // Collect projects information
  const projects = [];
  
  for (const jobId of jobDirs) {
    const jobDir = path.join(tempDir, jobId);
    
    // Find merged video files
    const files = fs.readdirSync(jobDir).filter(file => 
      file.startsWith('merged_') && file.endsWith('.mp4')
    );
    
    if (files.length > 0) {
      // Get file stats for creation date and size
      const filePath = path.join(jobDir, files[0]);
      const stats = fs.statSync(filePath);
      const createdAt = stats.birthtime;
      const size = stats.size;
      
      // Format size for display (KB, MB, etc.)
      let formattedSize;
      if (size < 1024) {
        formattedSize = `${size} B`;
      } else if (size < 1024 * 1024) {
        formattedSize = `${(size / 1024).toFixed(1)} KB`;
      } else if (size < 1024 * 1024 * 1024) {
        formattedSize = `${(size / (1024 * 1024)).toFixed(1)} MB`;
      } else {
        formattedSize = `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
      }
      
      // Check if S3 info exists
      let s3Url = null;
      const s3InfoFile = path.join(jobDir, 's3_info.json');
      if (fs.existsSync(s3InfoFile)) {
        try {
          const s3Info = JSON.parse(fs.readFileSync(s3InfoFile, 'utf8'));
          if (s3Info && s3Info.url) {
            s3Url = s3Info.url;
          }
        } catch (error) {
          console.error(`Error reading S3 info for job ${jobId}:`, error);
        }
      }
      
      // Calculate a title from the filename
      const fileName = files[0];
      const title = fileName.replace('merged_', '').replace('.mp4', '');
      
      // Add to projects array
      projects.push({
        id: uuidv4(), // Generate a unique ID for the project
        jobId: jobId,
        title: `Project ${title}`,
        createdAt: createdAt.toISOString(),
        size: formattedSize,
        duration: 0, // We would need to extract this from the video file
        status: 'completed',
        s3Url: s3Url,
        fileName: fileName
      });
    }
  }
  
  // Sort projects by creation date (newest first)
  projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return projects;
};

// Get a single project by ID
const getProjectById = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: 'Project ID is required'
      });
    }

    // Find the project in the database
    const project = await Project.findById(projectId);
    
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      project
    });
    
  } catch (error) {
    console.error('Error fetching project details:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching project details',
      error: error.message
    });
  }
};

module.exports = {
  getUserProjects,
  deleteProject,
  createProject,
  getProjectById,
  safeObjectId // Export the helper function in case it's needed elsewhere
}; 