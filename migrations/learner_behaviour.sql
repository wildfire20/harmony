-- Additive behaviour records. Does not import paper incidents or change learner data.
SELECT pg_advisory_xact_lock(hashtext('harmony:learner-behaviour:v1'));
CREATE TABLE IF NOT EXISTS behaviour_types (
 id SERIAL PRIMARY KEY,code VARCHAR(12) UNIQUE NOT NULL,kind VARCHAR(10) NOT NULL CHECK(kind IN ('merit','demerit')),
 label VARCHAR(300) NOT NULL CHECK(length(trim(label)) BETWEEN 3 AND 300),category SMALLINT,points INTEGER,
 is_active BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((kind='merit' AND category IS NULL AND points IS NULL) OR
       (kind='demerit' AND category IS NOT NULL AND points IS NOT NULL AND category BETWEEN 1 AND 4 AND points BETWEEN 1 AND 100))
);
CREATE TABLE IF NOT EXISTS behaviour_records (
 id SERIAL PRIMARY KEY,student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 type_id INTEGER NOT NULL REFERENCES behaviour_types(id) ON DELETE RESTRICT,
 type_code VARCHAR(12) NOT NULL,kind VARCHAR(10) NOT NULL CHECK(kind IN ('merit','demerit')),
 label VARCHAR(300) NOT NULL,category SMALLINT,points INTEGER,event_date DATE NOT NULL,
 notes VARCHAR(1000) NOT NULL DEFAULT '',recorded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 request_key UUID NOT NULL UNIQUE,request_hash VARCHAR(64) NOT NULL,
 status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK(status IN ('active','voided')),
 voided_by INTEGER REFERENCES users(id) ON DELETE RESTRICT,voided_at TIMESTAMPTZ,void_reason VARCHAR(500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((kind='merit' AND category IS NULL AND points IS NULL) OR
       (kind='demerit' AND category IS NOT NULL AND points IS NOT NULL AND category BETWEEN 1 AND 4 AND points BETWEEN 1 AND 100)),
 CHECK((status='active' AND voided_by IS NULL AND voided_at IS NULL AND void_reason IS NULL) OR
       (status='voided' AND voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND length(trim(void_reason)) BETWEEN 10 AND 500))
);
CREATE INDEX IF NOT EXISTS behaviour_records_learner_date ON behaviour_records(student_id,event_date DESC,id DESC);
CREATE OR REPLACE FUNCTION preserve_behaviour_record_history() RETURNS TRIGGER AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Behaviour history cannot be deleted'; END IF;
 IF OLD.status<>'active' OR NEW.status<>'voided' OR
    (to_jsonb(NEW)-ARRAY['status','voided_by','voided_at','void_reason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','voided_by','voided_at','void_reason']) THEN
   RAISE EXCEPTION 'Behaviour history is immutable; void an incorrect record with a reason';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS behaviour_records_history ON behaviour_records;
CREATE TRIGGER behaviour_records_history BEFORE UPDATE OR DELETE ON behaviour_records
 FOR EACH ROW EXECUTE FUNCTION preserve_behaviour_record_history();
INSERT INTO behaviour_types(code,kind,label,category,points) VALUES
('M001','merit','Helped clean the classroom',NULL,NULL),
('M002','merit','Was obedient and listened to the teacher',NULL,NULL),
('M003','merit','Helped the teacher',NULL,NULL),
('M004','merit','Produced neat work',NULL,NULL),
('M005','merit','Showed good manners',NULL,NULL),
('M006','merit','Played appropriately with friends',NULL,NULL),
('1001','demerit','Homework not done, incomplete or not written down',1,2),
('1002','demerit','Books, homework book or stationery not at school',1,2),
('1003','demerit','Not working, distracting classmates or playing during work',1,2),
('1004','demerit','Talking, making sounds, walking around, shouting or not putting up a hand',1,2),
('1005','demerit','Test, FAT or notice not given to parent to sign',1,2),
('1006','demerit','Late for class or leaving class without permission',1,2),
('1007','demerit','Not looking after property or rocking a chair',1,2),
('1008','demerit','Eating in class or chewing gum',1,2),
('1009','demerit','Not respecting class leader, anthems or school uniform rules',1,2),
('1010','demerit','Disobedience in the hall, assembly or bathroom',1,2),
('2001','demerit','Repeated Category 1 violations (Head of Discipline)',2,6),
('2002','demerit','Disrespecting Student Council',2,10),
('2003','demerit','Using a cellphone without permission',2,10),
('2004','demerit','Not being a good school ambassador or disobedience',2,10),
('2005','demerit','Disrespectful, rude or rebellious towards a teacher',2,10),
('2006','demerit','Drawing inappropriate pictures or writing vulgar letters',2,10),
('2007','demerit','Cursing or foul language',2,10),
('2008','demerit','Dishonesty with minor consequences or falsifying a signature',2,10),
('2009','demerit','Running on the stoep or playing where not permitted',2,10),
('2010','demerit','Littering or refusing to help clean school property',2,10),
('2011','demerit','Frequently late or absent from practice, duties or detention',2,10),
('3002','demerit','Misconduct or dishonesty in a test, FAT or exam',3,15),
('3003','demerit','Teasing or public humiliation',3,15),
('3004','demerit','Social exclusion',3,15),
('3005','demerit','Verbal threats to safety, intimidation or stalking',3,15),
('3006','demerit','Physical violence',3,15),
('3007','demerit','Theft, destruction of property or hiding another learner’s property',3,15),
('3008','demerit','Sexual, religious, racial affliction',3,15),
('3009','demerit','Extortion',3,15),
('3010','demerit','Intentional violation of a person’s dignity or privacy',3,15),
('3011','demerit','Cyberbullying',3,15),
('4001','demerit','Repeated violation of school rules (Head of Discipline)',4,20),
('4002','demerit','Serious assault',4,20),
('4003','demerit','Possessing, using or selling alcohol, drugs or cigarettes',4,20),
('4004','demerit','Possessing or spreading pornography',4,20),
('4005','demerit','Using, threatening with or possessing a dangerous weapon',4,20),
('4006','demerit','Serious disruptive behaviour that impedes learning',4,20),
('4007','demerit','Robbery or serious theft',4,20),
('4008','demerit','Sexual harassment or abuse',4,20)
ON CONFLICT(code) DO NOTHING;
