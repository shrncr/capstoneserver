/*
Server Side Setup
Will allow for communication between RPi and Extension
Will allow for DB access
Add an env file with your uri before doing npm start
*/
require('dotenv').config(); //with db uri
const express = require('express'); //routing
const cors = require('cors'); //https security
const { Sequelize, DataTypes } = require('sequelize'); //js library thatll make it easy for me to use postgres tables

const app = express();//start express app
app.use(cors());
app.use(express.json());

const sequelize = new Sequelize(process.env.DATABASE_URL, {//connect to postgres
    dialect: 'postgres',
    logging: false
});

const Professor = sequelize.define('professor', {//professor db schema
    name: { type: DataTypes.STRING, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false }
},{ timestamps: false });
const Course = sequelize.define('course', {//course db schema
    name: { type: DataTypes.STRING, allowNull: false }
},{ timestamps: false });
const Student = sequelize.define('student', {//student db schema
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

app.post('/addcourse', async (req, res) => { //professor can add a single course with CSV file upload which contains students
    const { coursecsv, name } = req.body;
    const professor = await Professor.findOne({ where: { name, pin } });
    if (professor) {
        res.json({ success: true, professor_id: professor.id });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/updateCourse', async (req, res) => { //professor can add a new file to update a course in which a student dropped. (remove courseID x, add new one)
    const { name, pin } = req.body;
    const professor = await Professor.findOne({ where: { name, pin } });
    if (professor) {
        res.json({ success: true, professor_id: professor.id });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/removePastCourses', async (req, res) => { //professor can add disable all past courses
    const { name, pin } = req.body;
    const professor = await Professor.findOne({ where: { name, pin } });
    if (professor) {
        res.json({ success: true, professor_id: professor.id });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/removeCourse', async (req, res) => { //professor can add disable a single past course
    const { professor_id, courseName} = req.body;
    await Course.destroy({where: {professor_id, courseName}}).then(

    ).catch(error){
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const professor = await Professor.findOne({ where: { name, pin } });
    if (professor) {
        res.json({ success: true, professor_id: professor.id });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// app.post('/checkIfStudentInCourse', async (req, res) => {
// })

// app.post('uploadStudentPictures', async (req, res) => {
// })
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
app.post('/attendance', async (req, res) => {//adds attendence to db.. idk if needed
    const { studentId, course_id, status } = req.body;
    const attendance = await Attendance.create({ studentId, course_id, status });
    res.json(attendance);
});
app.get('/:courseId/attendance', async (req, res) => {//finds all past attendence for a current course
    const attendance = await Attendance.findAll({ where: { course_id: req.params.courseId } });
    res.json(attendance);
});

app.listen(5000, () => console.log('Server running on port 5000'));
