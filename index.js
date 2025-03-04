/*
Server Side Setup
Will allow for communication between RPi and Extension
Will allow for DB access
Add an env file with your uri before doing npm start
*/
require('dotenv').config(); //with db uri
const express = require('express'); //routing
const cors = require('cors'); //https security
const multer = require('multer');
const streamifier = require('streamifier');
const csvParser = require('csv-parser');
const Papa = require('papaparse');
const { Sequelize, DataTypes } = require('sequelize'); //js library thatll make it easy for me to use postgres tables
const path = require('path');

const app = express();//start express app
app.use(cors());
app.use(express.json());


const storage = multer.memoryStorage(); // Store files in memory instead of disk
const upload = multer({ storage });

const sequelize = new Sequelize(process.env.SUPABASE_DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    dialectModule: require("pg"),
    logging: false
});


const Professor = sequelize.define('professor', {//professor db schema
    name: { type: DataTypes.STRING, allowNull: false },
    pin: { type: DataTypes.STRING, allowNull: false }
},{ timestamps: false });
const Course = sequelize.define('course', {//course db schema
    name: { type: DataTypes.STRING, allowNull: false },
    isCurrent:{type: Boolean,allowNull: false},
    professor_id:{type:DataTypes.INTEGER}
},{ timestamps: false });
const Student = sequelize.define('student', {//student db schema
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true 
    },
    name: { type: DataTypes.STRING, allowNull: false },
    face_encoding: { type: DataTypes.JSON, allowNull: false },
    course_id:{ type: DataTypes.INTEGER, allowNull: false },
},{ timestamps: false });
const Attendance = sequelize.define('attendance', {//attendence db schema. la la la
    timestamp: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    status: { type: DataTypes.ENUM('Present', 'Absent'), allowNull: false }
},{ timestamps: false });

//relationships
Course.belongsTo(Professor, { foreignKey: 'professor_id' });
Student.belongsTo(Course, { foreignKey: 'course_id' });
Attendance.belongsTo(Student, { foreignKey: 'student_id' });
Attendance.belongsTo(Course, { foreignKey: 'course_id' });
sequelize.sync();

app.post('/login', async (req, res) => { //professor logs in with pin
    const { name, pin } = req.body;
    const professor = await Professor.findOne({ where: { name, pin } });
    if (professor) {
        res.json({ success: true, professor_id: professor.id });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get("/students/:courseId/encodings", async (req, res) => { //gets students in a current course's face encodings
    try {
        const students = await Student.findAll({ where: { course_id: req.params.courseId } });
        const response = students.map(student => ({
            id: student.id,
            face_encoding: student.face_encoding 
        }));
        res.json(response);
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({ error: "Error fetching students" });
    }
});
app.get('/courses/:professorId', async (req, res) => {//finds all of the professors courses
    const courses = await Course.findAll({ where: { professor_id: req.params.professorId } });
    res.json(courses);
});
app.get('/students/:course_id', async (req, res) => {//get students in a particular course
    const students = await Student.findAll({ where: { course_id: req.params.course_id } });
    res.json(students);
});

app.get('/:courseId/attendance', async (req, res) => {//finds all past attendence for a current course
    const attendance = await Attendance.findAll({ where: { course_id: req.params.courseId } });
    res.json(attendance);
});

app.post('/addcourse', upload.single('coursecsv'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        console.log("File received:", req.file);

        const results = [];
        const readableStream = streamifier.createReadStream(req.file.buffer); // Convert buffer to stream

        readableStream
            .pipe(csvParser()) // Parse CSV
            .on('data', (row) => {
                results.push(row);
            })
            .on('end', () => {
                console.log("Parsed CSV Data:", results);
                res.json({ success: true, message: 'File processed successfully', data: results });
            })
            .on('error', (err) => {
                console.error("CSV Parsing Error:", err);
                res.status(500).json({ success: false, message: 'Error parsing CSV', error: err.message });
            });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error processing file', error: error.message });
    }
});


app.post('/updateCourse', async (req, res) => {
    try {
        const { student_id, new_course_id } = req.body;
        await Student.update({ course_id: new_course_id }, { where: { id: student_id } });
        res.json({ success: true, message: 'Course updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error updating course', error });
    }
});

app.post('/removePastCourses', async (req, res) => {
    try {
        const { professor_id } = req.body;
        await Course.update({ isCurrent: false }, { where: { isCurrent: true, professor_id } });
        res.json({ success: true, message: 'Past courses disabled' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error disabling past courses', error });
    }
});

app.post('/removeCourse', async (req, res) => {
    try {
        const { professor_id, courseName } = req.body;
        await Course.destroy({ where: { professor_id, name: courseName } });
        res.json({ success: true, message: 'Course removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error removing course', error });
    }
});

app.post('/checkIfStudentInCourse', async (req, res) => {
    try {
        const { student_id, course_id } = req.body;
        const student = await Student.findOne({ where: { id: student_id, course_id } });
        res.json({ exists: !!student });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error checking student', error });
    }
});

app.post('/uploadStudentPictures', async (req, res) => {
    try {
        const { student_id, face_encoding } = req.body;
        await Student.update({ face_encoding }, { where: { id: student_id } });
        res.json({ success: true, message: 'Face encoding updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error uploading face encoding', error });
    }
});

app.post('/attendance', async (req, res) => {
    try {
        const { student_id, course_id, status } = req.body;
        const attendance = await Attendance.create({ student_id, course_id, status });
        res.json(attendance);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error recording attendance', error });
    }
});
const PORT = process.env.PORT || 8082;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
