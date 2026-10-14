export function departmentName(record = {}) {
  return String(record.studentDepartment || record.department || record.collegeDepartment || record.studentProgram || record.program || record.course || 'Department not specified').trim();
}
export function studentKey(record) {
  return String(record.studentUid || record.studentId || record.studentEmail?.toLowerCase() || `complaint:${record.id || record.complaintRef}`);
}
export function departmentSummary(records) {
  const groups = new Map();
  for (const record of records) {
    const name = departmentName(record);
    if (!groups.has(name)) groups.set(name, { name, students: new Set(), complaints: 0 });
    const group = groups.get(name);
    group.students.add(studentKey(record));
    group.complaints++;
  }
  return [...groups.values()].map(group => ({ name: group.name, students: group.students.size, complaints: group.complaints }))
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));
}
export function sortComplaints(records, sort = 'newest') {
  const ms = value => value?.toMillis?.() || value?.toDate?.()?.getTime() || new Date(value || 0).getTime() || 0;
  const states = ['Submitted', 'Under Review', 'In Progress', 'Resolved', 'Closed'];
  return [...records].sort((a, b) => {
    const recent = ms(b.createdAt) - ms(a.createdAt);
    if (sort === 'oldest') return -recent;
    if (sort === 'status') return states.indexOf(a.status || 'Submitted') - states.indexOf(b.status || 'Submitted') || recent;
    if (sort === 'department') return departmentName(a).localeCompare(departmentName(b)) || recent;
    return recent;
  });
}
