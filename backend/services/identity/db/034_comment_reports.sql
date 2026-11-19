ALTER TABLE content_reports DROP CONSTRAINT content_reports_subject_type_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_subject_type_check
  CHECK (subject_type IN ('message', 'post', 'comment', 'contribution'));
