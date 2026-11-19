-- Preserve the original coordinate editors before choosing the relationship at the bond step.
ALTER TABLE person_drafts
  ADD COLUMN real_name text CHECK (char_length(real_name) BETWEEN 1 AND 80),
  ADD COLUMN called_me text CHECK (char_length(called_me) BETWEEN 1 AND 80),
  ADD COLUMN birth_month_day text CHECK (
    birth_month_day ~ '^(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-9]))$'
  ),
  ADD COLUMN years_text text CHECK (char_length(years_text) BETWEEN 1 AND 120),
  ADD COLUMN place text CHECK (char_length(place) BETWEEN 1 AND 200);
