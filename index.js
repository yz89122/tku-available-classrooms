const cheerio = require('cheerio');
const axios = require('axios');
const querystring = require('querystring');
const csvStringify = require('csv-stringify');
const fsPromises = require('fs/promises');

const getCoursesOfColleges = async () => {
  const getColleges = async () => {
    const response = await axios.get(
      'http://esquery.tku.edu.tw/acad/query.asp'
    );
    const $ = cheerio.load(response.data);
    const colleges = $('#depts option')
      .map((_, element) => {
        const e = $(element);
        return {
          key: e.attr('value'),
          text: e.text(),
        };
      })
      .get();
    for (const college of colleges) {
      college.departments = getDepartmentsOfCollege(college);
    }
    for (const college of colleges) {
      college.departments = await college.departments;
    }
    return colleges;
  };

  const getDepartmentsOfCollege = async (college) => {
    const response = await axios.get(
      `http://esquery.tku.edu.tw/acad/query.asp?depts=${encodeURIComponent(
        college.key
      )}`
    );
    const $ = cheerio.load(response.data);
    const departments = $('#dept option')
      .map((_, element) => {
        const e = $(element);
        return {
          key: e.attr('value'),
          text: e.text(),
        };
      })
      .get();
    for (const department of departments) {
      department.courses = getCoursesOfDepartment(college, department);
    }
    for (const department of departments) {
      department.courses = await department.courses;
    }
    return departments;
  };

  const getCoursesOfDepartment = async (college, department) => {
    const response = await axios.post(
      'http://esquery.tku.edu.tw/acad/query_result.asp',
      querystring.stringify({
        func: 'go',
        R1: 1,
        depts: college.key,
        sgn1: '-',
        dept: department.key,
        level: 999,
      })
    );
    const $ = cheerio.load(response.data);
    const courses = parseCoursesTable($);
    if (courses.length == 0) {
      console.error(
        'no course:',
        college.key,
        college.text,
        department.key,
        department.text
      );
    }
    return courses;
  };

  return await getColleges();
};

const getCoursesOfCategories = async () => {
  const getCategories = async () => {
    const response = await axios.get(
      'http://esquery.tku.edu.tw/acad/query.asp'
    );
    const $ = cheerio.load(response.data);
    const categories = $('#Select1 option')
      .map((_, element) => {
        const e = $(element);
        return {
          key: e.attr('value'),
          text: e.text(),
        };
      })
      .get();
    for (const category of categories) {
      category.subcategories = getSubcategories(category);
    }
    for (const category of categories) {
      category.subcategories = await category.subcategories;
    }
    return categories;
  };

  const getSubcategories = async (category) => {
    const response = await axios.get(
      `http://esquery.tku.edu.tw/acad/query.asp?other=${encodeURIComponent(
        category.key
      )}`
    );
    const $ = cheerio.load(response.data);
    const subcategories = $('select[name="others"] option')
      .map((_, element) => {
        const e = $(element);
        return {
          key: e.attr('value'),
          text: e.text(),
        };
      })
      .get();
    for (const subcategory of subcategories) {
      subcategory.courses = getCoursesOfSubcategories(category, subcategory);
    }
    for (const subcategory of subcategories) {
      subcategory.courses = await subcategory.courses;
    }
    return subcategories;
  };

  const getCoursesOfSubcategories = async (category, subcategory) => {
    const response = await axios.post(
      'http://esquery.tku.edu.tw/acad/query_result.asp',
      querystring.stringify({
        func: 'go',
        R1: 5,
        other: category.key,
        sgn2: '-',
        others: subcategory.key,
      })
    );
    const $ = cheerio.load(response.data);
    const courses = parseCoursesTable($);
    if (courses.length == 0) {
      console.error(
        'no course:',
        category.key,
        category.text,
        subcategory.key,
        subcategory.text
      );
    }
    return courses;
  };

  return await getCategories();
};

const parseCoursesTableControlCodeRegex = /[0-9]+/;
const parseCoursesTable = ($) => {
  let lastChiefCourse = null;
  return $(
    'body > div > center > table:nth-child(10) > tbody > tr:not([bgcolor])'
  )
    .filter((_, element) => $(element).children().length > 2)
    .map((index, e) => {
      const element = $(e);
      const course = {
        grade: element.children(':nth-child(2)').text().trim(),
        control_code: element.children(':nth-child(3)').text().trim(),
        course_number: element.children(':nth-child(4)').text().trim(),
        trade: element.children(':nth-child(5)').text().trim(),
        section: element.children(':nth-child(6)').text().trim(),
        class: element.children(':nth-child(7)').text().trim(),
        group: element.children(':nth-child(8)').text().trim(),
        required_or_selective: element.children(':nth-child(9)').text().trim(),
        credit: element.children(':nth-child(10)').text().trim(),
        field: element.children(':nth-child(11)').text().trim(),
        courses: element.children(':nth-child(12)').text().trim(),
        enrollment_maximum: element.children(':nth-child(13)').text().trim(),
        instructor: element.children(':nth-child(14)').text().trim(),
        periods: parsePeriodsStrings(
          element.children(':nth-child(15)').text().trim(),
          element.children(':nth-child(16)').text().trim()
        ),
      };
      const result = parseCoursesTableControlCodeRegex.exec(
        course.control_code
      );
      if (result) {
        const controlCode = result[0];
        const remaining = course.control_code.replace(controlCode, '').trim();
        course.control_code = controlCode;
        course.control_code_sub = remaining;
        course.chief_course = lastChiefCourse;
      } else {
        lastChiefCourse = course;
        course.control_code_sub = course.control_code;
        course.control_code = null;
      }
      if (course.periods.some((value) => isNaN(value.time_period))) {
        console.error(
          college.key,
          college.text,
          department.key,
          department.text,
          course,
          element.children(':nth-child(15)').text().trim(),
          element.children(':nth-child(16)').text().trim()
        );
      }
      return course;
    })
    .get();
};

const parsePeriodsStrings = (...strings) => {
  const result = new Array();
  for (const string of strings) {
    if (!string) continue;
    const [weekday, periodsString, classroom] = string
      .split('/')
      .map((value) => value.trim());
    if (!weekday || !periodsString) continue;
    for (const timePeriod of periodsString
      .split(',')
      .map((value) => parseInt(value))) {
      result.push({
        weekday,
        time_period: timePeriod,
        classroom: parseClassroom(classroom),
      });
    }
  }
  return result;
};

const parseClassroomRegex = /^([a-zA-Z]+)\s+([0-9a-zA-Z]+)$/;
const parseClassroom = (classroom) => {
  if (!classroom) return null;
  const result = parseClassroomRegex.exec(classroom);
  if (!result) {
    console.error('Unknown classroom format', classroom);
    return classroom;
  }
  return {
    building: result[1],
    room_number: result[2],
  };
};

const getClassroomsFromCollegesAndCategories = (colleges, categories) => {
  const classrooms = new Object();
  for (const college of colleges) {
    for (const department of college.departments) {
      addCoursesClassroomsToClassroomSet(classrooms, department.courses);
    }
  }
  for (const category of categories) {
    for (const subcategory of category.subcategories) {
      addCoursesClassroomsToClassroomSet(classrooms, subcategory.courses);
    }
  }
  const result = new Array();
  for (const [building, roomNumbers] of Object.entries(classrooms)) {
    const rooms = new Array();
    result.push({ key: building, rooms });
    for (const roomNumber of roomNumbers) {
      rooms.push({ key: roomNumber });
    }
  }
  return result;
};

const addCoursesClassroomsToClassroomSet = (classrooms, courses) => {
  for (const course of courses) {
    for (const period of course.periods) {
      const { classroom } = period;
      if (!classroom) continue;
      if (!(classroom.building in classrooms)) {
        classrooms[classroom.building] = new Set();
      }
      classrooms[classroom.building].add(classroom.room_number);
    }
  }
  return classrooms;
};

const getRequestFormatOfClassroom = (buildingKey, roomNumber) => {
  return (
    buildingKey +
    ' '.repeat(6 - buildingKey.length - roomNumber.length) +
    roomNumber
  );
};

const getClassroomSchedule = async (classroom) => {
  const response = await axios.post(
    'http://esquery.tku.edu.tw/acad/query_result.asp',
    querystring.stringify({
      func: 'go',
      R1: 7,
      classno: classroom,
    })
  );
  const $ = cheerio.load(response.data);
  const table = $('body > center > div:nth-child(3) > center > table > tbody');
  const schedule = Array(7)
    .fill()
    .map(() => Array(14).fill());
  for (let weekday = 0; weekday < 7; ++weekday) {
    const wd = schedule[weekday];
    for (let period = 0; period < 14; ++period) {
      const text = table
        .children(`tr:nth-child(${period + 2})`)
        .children(`td:nth-child(${weekday + 2})`)
        .text()
        .trim();
      wd[period] = text.length == 0;
    }
  }
  return schedule;
};

const getBuildingAvailableClassrooms = (classrooms) => {
  const result = new Array();
  for (const building of classrooms) {
    const schedule = Array(7)
      .fill()
      .map(() =>
        Array(14)
          .fill()
          .map(() => new Array())
      );
    for (const room of building.rooms) {
      const roomSchedule = room.schedule;
      for (let weekday = 0; weekday < 7; ++weekday) {
        const wd = roomSchedule[weekday];
        for (let period = 0; period < 14; ++period) {
          if (wd[period]) {
            schedule[weekday][period].push(room.key);
          }
        }
      }
    }
    for (let weekday = 0; weekday < 7; ++weekday) {
      const wd = schedule[weekday];
      for (let period = 0; period < 14; ++period) {
        wd[period].sort();
      }
    }
    result.push({ key: building.key, schedule });
  }
  return result;
};

const writeResultToCsv = async (result) => {
  const promises = new Array();
  for (const building of result) {
    const data = new Array();
    data.push([
      '',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    for (let period = 0; period < 14; ++period) {
      const row = new Array();
      row.push(period + 1);
      for (let weekday = 0; weekday < 7; ++weekday) {
        row.push(building.schedule[weekday][period].join('\n'));
      }
      data.push(row);
    }
    promises.push(
      new Promise((resolve, reject) => {
        csvStringify(data, (err, output) => {
          if (err) return reject(err);
          resolve({ key: building.key, data: output });
        });
      })
    );
  }
  await fsPromises.mkdir('output', { recursive: true });
  for await (const { key, data } of promises) {
    const fileHandle = await fsPromises.open(`output/${key}.csv`, 'w');
    await fileHandle.write(data);
    await fileHandle.close();
  }
};

(async () => {
  const [colleges, categories] = await Promise.all([
    getCoursesOfColleges(),
    getCoursesOfCategories(),
  ]);
  const classrooms = getClassroomsFromCollegesAndCategories(
    colleges,
    categories
  );
  for (const building of classrooms) {
    const buildingKey = building.key;
    for (const room of building.rooms) {
      const roomNumber = room.key;
      room.schedule = getClassroomSchedule(
        getRequestFormatOfClassroom(buildingKey, roomNumber)
      );
    }
  }
  for (const building of classrooms) {
    for (const room of building.rooms) {
      room.schedule = await room.schedule;
    }
  }
  const buildingAvailableClassrooms = getBuildingAvailableClassrooms(
    classrooms
  );
  await writeResultToCsv(buildingAvailableClassrooms);
})();
