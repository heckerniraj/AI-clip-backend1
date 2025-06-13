const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
    title: {},
    description : {},
    content : {},
    author : {},
    category : {},
    tags : {},
    image : {},
    createdAt : {},
});
