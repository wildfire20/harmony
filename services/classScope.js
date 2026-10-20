// Resolve legacy class references by grade and exact class label. Never cross grades
// or choose between ambiguous matches. No learner or assignment rows are rewritten.
const active = alias => `(NOT (to_jsonb(${alias}) ? 'is_active') OR to_jsonb(${alias})->>'is_active'='true')`;
const label = alias => `lower(trim(${alias}.name))`;
function resolvedClassId(grade, classId) {
  return `(SELECT CASE WHEN NOT (to_jsonb(ref) ? 'grade_id') OR (to_jsonb(ref)->>'grade_id')::integer=${grade}
    THEN ref.id ELSE (SELECT min(target.id) FROM classes target
      WHERE (to_jsonb(target)->>'grade_id')::integer=${grade} AND ${label('target')}=${label('ref')}
        AND ${active('target')} HAVING count(*)=1) END
    FROM classes ref WHERE ref.id=${classId} AND ${active('ref')})`;
}
function teacherScope(teacher, grade, classId) {
  const resolved = resolvedClassId(grade,classId);
  return `(EXISTS(SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id=${teacher}
    AND ta.grade_id=${grade} AND ${active('ta')} AND ${resolvedClassId('ta.grade_id','ta.class_id')}=${resolved})
    OR EXISTS(SELECT 1 FROM classes homeroom WHERE homeroom.id=${resolved} AND ${active('homeroom')}
      AND to_jsonb(homeroom)->>'teacher_id'=(${teacher})::text
      AND NOT EXISTS(SELECT 1 FROM teacher_assignments disabled WHERE disabled.teacher_id=${teacher}
        AND disabled.grade_id=${grade} AND ${resolvedClassId('disabled.grade_id','disabled.class_id')}=homeroom.id
        AND NOT ${active('disabled')})))`;
}
async function teacherClasses(executor,teacherId) {
  return (await executor.query(`SELECT c.id AS class_id,(to_jsonb(c)->>'grade_id')::integer AS grade_id,
    c.name AS class_name,g.name AS grade_name FROM classes c JOIN grades g ON g.id=(to_jsonb(c)->>'grade_id')::integer
    WHERE ${active('c')} AND ${teacherScope('$1',"(to_jsonb(c)->>'grade_id')::integer",'c.id')}
    ORDER BY g.name,c.name,c.id`,[teacherId])).rows;
}
module.exports={active,resolvedClassId,teacherScope,teacherClasses};
