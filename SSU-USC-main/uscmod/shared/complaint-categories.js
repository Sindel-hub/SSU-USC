export const COMPLAINT_CATEGORIES = Object.freeze([
  { name: 'Student Welfare and Services', office: 'Office of Student Affairs and Services (OSAS)', concerns: ['Student Welfare', 'Student Organizations and Activities', 'Student Support Services', 'Student Discipline and Conduct', 'Other Student-Related Concerns'] },
  { name: 'Data Privacy and Protection', office: 'Data Protection Officer (DPO)', concerns: ['Unauthorized Disclosure of Personal Information', 'Improper Use of Personal Information', 'Unauthorized Access to Student Records', 'Data Privacy Violations', 'Other Privacy-Related Concerns'] },
  { name: 'Technical and IT Support', office: 'Information and Communications Technology Office (ICTO)', concerns: ['Internet and Network Connectivity', 'University Website Issues', 'Student Information System Issues', 'Account and Login Problems', 'Other Technical Issues'] },
  { name: 'Facilities and Maintenance', office: 'Directorate for General Services', concerns: ['Air-conditioning and Ventilation', 'Electrical Equipment and Lighting', 'Classroom Furniture and Equipment', 'Restroom and Water Facilities', 'Building and Infrastructure Issues', 'Cleanliness and Sanitation', 'Other Facility-Related Concerns'] }
].map(item => Object.freeze({ ...item, concerns: Object.freeze(item.concerns) })));

// Keep the existing category field readable by student/officer history screens.
// Never assign a responsible office or USC review level from a student selection.
export function complaintCategoryLabel(category, concern) {
  const item = COMPLAINT_CATEGORIES.find(item => item.name === category);
  return item?.concerns.includes(concern) ? `${item.name} — ${concern}` : '';
}
export function selectedComplaintCategory(form) {
  return complaintCategoryLabel(form?.querySelector('#category')?.value, form?.querySelector('#specificConcern')?.value);
}
export function bindComplaintCategories(form) {
  const category = form?.querySelector('#category');
  const concern = form?.querySelector('#specificConcern');
  if (!category || !concern) return;
  function option(label, value = '') { const el = document.createElement('option'); el.textContent = label; el.value = value; return el; }
  category.replaceChildren(option('Select category'), ...COMPLAINT_CATEGORIES.map(item => option(item.name, item.name)));
  function sync(reset = false) {
    const item = !reset && COMPLAINT_CATEGORIES.find(item => item.name === category.value);
    concern.replaceChildren(option(item ? 'Select specific concern' : 'Select a category first'), ...(item ? item.concerns.map(label => option(label, label)) : []));
    concern.disabled = !item;
  }
  category.addEventListener('change', () => sync());
  form.addEventListener('reset', () => sync(true));
  sync();
}
