/*
Server Side Setup
Will allow for communication between RPi and Extension
Will allow for DB access
*/
require('dotenv').config(); //with db uri
const express = require('express'); //routing
const cors = require('cors'); //https security
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const streamifier = require('streamifier');
const csvParser = require('csv-parser');
const Papa = require('papaparse');
const { Sequelize, DataTypes } = require('sequelize'); //js library thatll make it easy for me to use postgres tables
const path = require('path');
const { Op } = require("sequelize");
const app = express();//start express app
app.use(cors({
    origin: '*',  // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    
}));

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
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true 
    },
    name: { type: DataTypes.STRING, allowNull: false },
    isCurrent:{type: Boolean,allowNull: false},
    professor_id:{type:DataTypes.INTEGER},
    students: { 
        type: DataTypes.ARRAY(DataTypes.INTEGER), // Store array of student IDs
        defaultValue: [] 
    }
},{ timestamps: false });
const Student = sequelize.define('student', {//student db schema
    id: { 
        type: DataTypes.INTEGER, 
        primaryKey: true 
    },
    name: { type: DataTypes.STRING, allowNull: false },
    number: {type:DataTypes.STRING, allowNull: true},
    email:{type:DataTypes.STRING, allowNull: true, unique:true},
    password:{type:DataTypes.STRING, allowNull: true},
    face_encoding: { type: DataTypes.JSON, allowNull: true },
    registered: {type:DataTypes.BOOLEAN, allowNull:false, defaultValue:false}
},
{ timestamps: false,
    hooks:{
        beforeUpdate: async (Student) => {
            if (Student.changed('password')) {
              Student.password = await bcrypt.hash(Student.password, 10);
            }
          },
    }
 },
);
const Attendance = sequelize.define('attendance', {//attendence db schema. la la la
    timestamp: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    status: { type: DataTypes.ENUM('Present', 'Absent'), allowNull: false }
},{ timestamps: false });

//relationships
Course.belongsTo(Professor, { foreignKey: 'professor_id' });
//Student.belongsTo(Course, { foreignKey: 'course_id' });
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
app.post('/signup', async (req, res) => { //professor logs in with pin
    try {
        const { name, pin } = req.body;
        const newUser = await Professor.create({ name, pin});

        res.status(201).json({ success: true, message: "User created successfully", user: newUser, });
    } catch (error) {
      res.status(400).json({success: false, message: error.message });
    }
});

app.post('/student/signup', async (req, res) => {
    try {
        const { password, studentId, email, number } = req.body;
        const signingUpUser = await Student.findByPk(studentId);

        if (!signingUpUser) {
            console.log("Student not found in DB:", studentId);
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        if (signingUpUser.registered) {
            return res.status(403).json({ success: false, message: "Account already exists for this user" });
        }

        // Ensure the update is awaited
        await signingUpUser.update({
            password: password,
            email: email,
            number: number,
            registered: true
        });

        return res.status(201).json({ success: true, message: "User created successfully", user: signingUpUser });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/student/login', async (req, res) => { //professor logs in with pin
    try {
        const { email, password } = req.body;
        const user = await Student.findOne({ where: { email } });

        const isPasswordValid = await bcrypt.compare(password.trim(), user.password.trim());
    console.log(isPasswordValid);

    if (!user || !isPasswordValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
          );
//token
        res.status(201).json({ success: true, message: "User created successfully", token: token, });
    } catch (error) {
      res.status(400).json({success: false, message: error.message });
    }
});

app.get("/students/:courseId/encodings", async (req, res) => { 
    //returns all students' ids and face encodings in a course
    try {
        const course = await Course.findOne({ where: { id: req.params.courseId } });
        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }

        const studentIds = course.students || [];

        if (studentIds.length === 0) {
            return res.json([]); // Return empty array if no students are in the course
        }

        const students = await Student.findAll({ where: { id: studentIds } });
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

app.post("/studentInfo", async (req, res) => {
    try {
      //make it give the token tho
      const user  = req.body.user;
      jwt.verify(user, process.env.JWT_SECRET, async function(err, decoded){
        console.log(decoded)
        console.log(decoded.id) 
        const userInfo = await Student.findByPk(decoded.id);
        const courses= await Course.findAll({where: {students: {[Op.contains]: [decoded.id]}}})
        if (!userInfo) {
          return res.status(401).json({ message: "Invalid credentials" });
        }
        res.status(200).json({ userInfo, courses });
      })
      
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });
  
app.get("/students/:courseId", async (req, res) => { 
    //returns all students' ids and face encodings in a course
    try {
        const course = await Course.findOne({ where: { id: req.params.courseId } });
        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }

        const studentIds = course.students || [];

        if (studentIds.length === 0) {
            return res.json([]); // Return empty array if no students are in the course
        }

        const students = await Student.findAll({ where: { id: studentIds } });
        const response = students.map(student => ({
            id: student.id,
            name: student.name 
        }));

        res.json(response); 
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({ error: "Error fetching students" });
    }
});


app.get('/courses/:professorId', async (req, res) => {//finds all of the professors courses
    const courses = await Course.findAll({ where: { professor_id: req.params.professorId, isCurrent: true } });
    res.json(courses);
});

app.get('/course/:courseId/students', async (req, res) => { //get all students in a course
    try {
        const courseId = req.params.courseId;
        const course = await Course.findOne({ where: { id: courseId } });

        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        const studentIds = course.students || [];
        const students = await Student.findAll({ where: { id: studentIds } });

        res.json({ success: true, students });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error fetching students', error: error.message });
    }
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
        console.log("File received:", req.file.originalname);
        const fileName = req.file.originalname;
        console.log("Uploaded Filename:", req.file.originalname);

        const fileRegex = /^export_course_(\d+)_users_\d+_\d+_\d{4},\s\d+_\d+_\d+\s(AM|PM)\.csv$/;

        const match = fileName.match(fileRegex);
        console.log(match)

        if (!match) {
            return res.status(400).json({ success: false, message: 'Invalid filename format' });
        }

        const courseId = parseInt(match[1]); // Extract course ID
        const professorId = req.body.professor_id; // Get professor ID from request body
        if (!professorId) {
            return res.status(400).json({ success: false, message: 'Professor ID is required' });
        }

        const students = [];
        let courseName = null;

        const readableStream = streamifier.createReadStream(req.file.buffer);

        readableStream
            .pipe(csvParser())
            .on('headers', (headers) => {
                const requiredHeaders = ['Name', 'Login ID', 'SIS ID', 'Section', 'Role', 'Last Activity', 'Total Activity'];
                const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
                const expectedHeaders = requiredHeaders.map(h => h.trim().toLowerCase());

                if (JSON.stringify(normalizedHeaders) !== JSON.stringify(expectedHeaders)) {
                    return res.status(400).json({ success: false, message: 'CSV headers do not match expected format' });
                }
            })
            .on('data', (row) => {
                if (!courseName) courseName = row['Section']; 
                students.push({ name: row['Name'], id: row['SIS ID'], section: row['Section'] });
            })
            .on('end', async () => {
                try {
                    let course = await Course.findOne({ where: { id: courseId } });
                    if (!course) {
                        course = await Course.create({ 
                            id: courseId, 
                            name: courseName, 
                            isCurrent: true, 
                            professor_id: professorId 
                        });
                    }
                    const studentIds = [];
                    for (let student of students) {
                        let existingStudent = await Student.findOne({ where: { id: student.id } });
                        if (!existingStudent) {
                            existingStudent = await Student.create({ name: student.name, id: student.id });
                        }
                        studentIds.push(existingStudent.id);
                    }
                    await course.update({ students: studentIds });

                    res.json({ success: true, message: 'Course and students added successfully', course });
                } catch (err) {
                    console.error("Database error:", err);
                    res.status(500).json({ success: false, message: 'Error updating database', error: err.message });
                }
            });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error processing file', error: error.message });
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

app.post('/removeCourse', async (req, res) => {//makes course inactive by courseID
    try {
        const { professor_id, course_id } = req.body;
        await Course.update(
            { isCurrent: false }, 
            { 
                where: { 
                    isCurrent: true, 
                    professor_id: professor_id, 
                    id: course_id 
                } 
            }
        );
        res.status(200).json({ success: true, message: 'Course removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error removing course', error });
    }
});

app.post('/checkIfStudentInCourse', async (req, res) => {
    try {
        const { student_id, course_id } = req.body;
        const course = await Course.findOne({ where: { id: course_id } });

        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        const isStudentInCourse = course.students.includes(student_id);

        res.json({ exists: isStudentInCourse });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Error checking student', error: error.message });
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
const PORT = process.env.PORT |5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  