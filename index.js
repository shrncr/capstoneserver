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
const socketIo = require('socket.io');
const { Sequelize, DataTypes, where } = require('sequelize'); //js library thatll make it easy for me to use postgres tables
const path = require('path');
const http = require('http');
const { Op } = require("sequelize");
const app = express();//start express app
const server = http.createServer(app);
const io = socketIo(server); 
app.use(cors({
    origin: ['http://localhost:3000', 'chrome-extension://gnbkoibamkgmpjjdjcpklbeiebandkod', 'chrome-extension://ophflbbajpmmhfjkfpjpglfaapelmkfj', 'chrome-extension://mgmaaldoomhgjigkegoebfbdbgmmcnma','chrome-extension://cldcoaaoanjlgjodnafeapnaommcmhie',  'chrome-extension://jabbmdnfncbfldfdeedhpnpbnljehpib', "http://127.0.0.1:5001",
        'chrome-extension://dcbmdamicjlhpencmfggghalkhhaakka', 'chrome-extension://hpkghbcgocjbfkbglccebjcejcgeofom', 'chrome-extension://dcbmdamicjlhpencmfggghalkhhaakka'
     ] ,//allow requests from frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'], 
    allowedHeaders: ['Content-Type', 'Authorization', 'User-Agent', 'Accept', 'Referer'], 
    credentials: true, //cookies
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
    isCurrent:{type: DataTypes.BOOLEAN,allowNull: false},
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
    status: { type: DataTypes.ENUM('Present', 'Absent'), allowNull: false },
    student_id:{type:DataTypes.INTEGER, allowNull:false},
    session_id: {type:DataTypes.INTEGER, allowNull:false},
},{ timestamps: false });
const attendencesession = sequelize.define('attendencesession', {//attendence db schema. la la la
    created_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    ended_at: { type: DataTypes.DATE, defaultValue:null },
    isActive: {type:DataTypes.BOOLEAN, defaultValue: true},
    roomId: {type:DataTypes.INTEGER, allowNull:false},
    courseId:{type:DataTypes.INTEGER, allowNull:false},
});
const attendenceBySession = sequelize.define('attendenceBySession', {//attendence db schema. la la la
    attendenceId:{type:DataTypes.INTEGER, allowNull:false},
    attendencesessionid:{type:DataTypes.INTEGER, allowNull:false},
});
//relationships
Course.belongsTo(Professor, { foreignKey: 'professor_id' });
//Student.belongsTo(Course, { foreignKey: 'course_id' });
Attendance.belongsTo(Student, { foreignKey: 'student_id' });
attendenceBySession.belongsTo(Attendance, { foreignKey: 'attendenceId' });
attendenceBySession.belongsTo(attendencesession, { foreignKey: 'attendencesessionid' });
attendencesession.belongsTo(Course, { foreignKey: 'courseId' });
Course.belongsTo(attendenceBySession, {foreignKey:"courseId"})
sequelize.sync();

// Handle a socket connection from a client
io.on('connection', (socket) => {
    console.log('A user connected.');
  
    // Send a welcome message when the client connects
    socket.emit('server_message', { data: 'Welcome to the server!' });
  
    // Listen for a custom message from the client
    socket.on('client_message', (data) => {
      console.log('Message from client:', data);
      // Send a response back to the client
      socket.emit('server_response', { data: 'Message received!' });
    });
  
    // Handle disconnect event
    socket.on('disconnect', () => {
      console.log('A user disconnected.');
    });
  });

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
app.post('/removefacemodel',async (req, res) => {
    try{
        const token = req.headers['authorization']?.split(' ')[1];  // Extract token from Authorization header
        let studentid;
        if (!token) {
          return res.status(403).json({ message: "No token provided" });
        }
        
        jwt.verify(token, process.env.JWT_SECRET, async function (err, decoded) {
          if (err) {
            return res.status(401).json({ message: "Invalid or expired token" });
          }
    
          console.log(decoded);
          studentid= decoded.id
        })
        const student = await Student.findByPk(studentid);
        console.log(student)
        if (student){
            const s = await student.update({face_encoding: null})
        }else{
            return res.status(404).json({ success: false, message: "Student not found" });
        }
        
        return res.status(200).json({ success: true, message: "Student face encoding removed", student });
    }catch(err){
        return res.status(500).json({ success: false, message: "idk whats wrong" });

    }
})
app.get('facemodel/:studentid',async (req, res) => {

})
app.post('/student/signup', async (req, res) => {
    try {
        const { password, studentId, email, number } = req.body;
        const signingUpUser = await Student.findByPk(studentId);

        if (!signingUpUser) {
            console.log("Student not found in DB:", studentId);
            return res.status(404).json({ success: false, message: "Student not found" });
        }

        // if (si gningUpUser.registered === true) {
        //     return res.status(403).json({ success: false, message: "Account already exists for this user" });
        // }
 
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

        const students = await Student.findAll({ where: { id: studentIds, face_encoding: { [Op.ne]: null }} });
        const response = students.map(student => ({
            id: student.id,
            face_encoding: student.face_encoding 
        }));

        res.status(200).json({students: response}); 
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({ error: "Error fetching students" });
    }
});

app.post("/studentInfo", async (req, res) => {
    try {
      const token = req.headers['authorization']?.split(' ')[1];  // Extract token from Authorization header
      
      if (!token) {
        return res.status(403).json({ message: "No token provided" });
      }
      
      jwt.verify(token, process.env.JWT_SECRET, async function (err, decoded) {
        if (err) {
          return res.status(401).json({ message: "Invalid or expired token" });
        }
  
        console.log(decoded);
        const userInfo = await Student.findByPk(decoded.id);
        const courses = await Course.findAll({ where: { students: { [Op.contains]: [decoded.id] }, isCurrent:true } });
        
        if (!userInfo) {
          return res.status(404).json({ message: "User not found" });
        }
  
        res.status(200).json({ userInfo, courses });
      });
  
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
        console.log("fneo"
        )
        await Student.update({ face_encoding }, { where: { id: student_id } });
        res.json({ success: true, message: 'Face encoding updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error uploading face encoding', error });
    }
}); 

app.post('/attendance', async (req, res) => {
    console.log("hi")
    // const Attendance = sequelize.define('attendance', {//attendence db schema. la la la
    //     timestamp: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
    //     status: { type: DataTypes.ENUM('Present', 'Absent'), allowNull: false },
    //     student_id:{type:DataTypes.INTEGER, allowNull:false},
    //     session_id: {type:DataTypes.INTEGER, allowNull:false},
    try {
        const { student_id, course_id, status, session_id } = req.body;
        const attendance = await Attendance.create({ student_id, status, session_id });
        res.status(201).json({success: true, attendence:attendance});
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error recording attendance', error });
    }
});

app.get('/attendance/:sessionID', async (req, res) => {
    try {
        const sessionAttendance = await Attendance.findAll({
            where: { session_id: req.params.sessionID },
            include: [
                {
                    model: Student, // assuming you have this model defined and associated
                    as: 'student',  // use alias if defined in association
                    attributes: { exclude: ['createdAt', 'updatedAt'] } // optional: clean up response
                }
            ]
        });

        if (sessionAttendance.length > 0) {
            return res.json({ success: true, attendance: sessionAttendance });
        } else {
            return res.json({ success: false, message: 'No attendance session found' });
        }
    } catch (error) {
        console.error('Error fetching attendance:', error);
        res.status(500).json({ success: false, message: 'Server error', error });
    }
});


app.get('/sessions/:courseid', async (req, res) => {
    // Query the database or cache for an active session for the course.
    // For a simple implementation, you might return a boolean or session details.
    const sessions = await attendencesession.findAll({ where: { courseId: req.params.courseid } });
    if (sessions) {
        return res.json({ success: true, attendences: sessions });
    } else {
        return res.json({ success: false, message: 'No attendance session' });
    }
});

app.post('/startAttendence', async (req, res) => {

    try {
        let {courseId,roomId} = req.body
        const activeSession = await attendencesession.create({roomId:roomId, courseId:courseId})
        let sessionId = activeSession.id
        io.emit('attendanceStarted', { sessionId, courseId, sessionId, roomId, timestamp: Date.now() });
        res.status(200).json(activeSession);
    } catch (error) {
        console.error('Error:', error);

        // Send a response with the error details
        res.status(500).json({
            success: false,
            message: 'Error recording attendance',
            error: error.message || 'Unknown error'
        });
    }
});
app.get("/", (req, res) => res.send("Hello Railway!"));

app.post('/closeAttendenceSession', async (req, res) => {
    // Query the database or cache for an active session for the course.
    // For a simple implementation, you might return a boolean or session details.
    try {
        let {courseId,roomId} = req.body
        const activeSession = await attendancesession.findOne({where:{courseId:courseId, roomId:roomId}})
        res.status(200).json(activeSession);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error recording attendance', error });
    }
});
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    