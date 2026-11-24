export const SSU_PROGRAMS = Object.freeze({
  "College of Education": [
    "Bachelor of Elementary Education",
    "Bachelor of Early Childhood Education",
    "Bachelor of Physical Education",
    "Bachelor of Secondary Education Major in English",
    "Bachelor of Secondary Education Major in Mathematics",
    "Bachelor of Secondary Education Major in Science",
    "Bachelor of Secondary Education Major in Social Studies"
  ],
  "College of Arts and Sciences": [
    "Bachelor of Science in Information Technology",
    "Bachelor of Science in Information Systems",
    "Bachelor of Science in Psychology",
    "Bachelor of Science in Statistics"
  ],
  "College of Nursing and Health Sciences": [
    "Bachelor of Science in Nursing",
    "Bachelor of Science in Nutrition and Dietetics",
    "Bachelor of Science in Pharmacy"
  ],
  "College of Engineering": [
    "Bachelor of Science in Civil Engineering",
    "Bachelor of Science in Electrical Engineering",
    "Bachelor of Science in Computer Engineering",
    "Bachelor of Science in Electronics Engineering"
  ],
  "College of Industrial Technology": [
    "Bachelor of Science in Architecture",
    "Bachelor of Industrial Technology Major in Automotive Technology",
    "Bachelor of Industrial Technology Major in Culinary Technology",
    "Bachelor of Industrial Technology Major in Electrical Technology",
    "Bachelor of Industrial Technology Major in Electronics Technology",
    "Bachelor of Industrial Technology Major in Architectural Drafting Technology",
    "Bachelor of Industrial Technology Major in Mechanical Technology",
    "Bachelor of Industrial Technology Major in Heating, Ventilating Air-Conditioning and Refrigeration Technology",
    "Bachelor of Industrial Technology Major in Beauty Care and Wellness Technology",
    "Bachelor of Industrial Technology Major in Apparel and Fashion Technology"
  ]
});

export function isValidSsuProgram(college, program) {
  return Array.isArray(SSU_PROGRAMS[college]) && SSU_PROGRAMS[college].includes(program);
}


const collegeAbbreviations = {
  "College of Arts and Sciences": "CAS",
  "College of Education": "COEd",
  "College of Nursing and Health Sciences": "CONHS",
  "College of Engineering": "CoEng",
  "College of Industrial Technology": "CIT"
};

export function formatSsuCollege(college) {
  const abbreviation = collegeAbbreviations[college];
  return abbreviation ? `${college} (${abbreviation})` : college;
}

export function formatSsuProgram(college, program) {
  const key = college?.replace(/ \(.*\)$/, '');
  if (key === 'College of Arts and Sciences') {
    if (program === 'Bachelor of Information Technology') return 'Bachelor of Science in Information Technology';
    if (program === 'Bachelor of Information System') return 'Bachelor of Science in Information Systems';
  }
  return SSU_PROGRAMS[key]?.find(name => name.toLowerCase() === program?.toLowerCase()) || program;
}
