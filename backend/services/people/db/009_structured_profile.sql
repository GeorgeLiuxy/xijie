CREATE FUNCTION people_profile_array_valid(items text[], item_limit integer, text_limit integer) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT COALESCE(array_ndims(items),1)=1 AND cardinality(items)<=item_limit
 AND NOT EXISTS(SELECT 1 FROM unnest(items) value WHERE value IS NULL OR char_length(value) NOT BETWEEN 1 AND text_limit OR btrim(value)<>value)
$$;
ALTER TABLE persons
 ADD COLUMN personality text[] NOT NULL DEFAULT '{}' CHECK(people_profile_array_valid(personality,30,200)),
 ADD COLUMN life text[] NOT NULL DEFAULT '{}' CHECK(people_profile_array_valid(life,100,1000)),
 ADD COLUMN unknowns text[] NOT NULL DEFAULT '{}' CHECK(people_profile_array_valid(unknowns,30,500)),
 ADD COLUMN catchphrase text CHECK(catchphrase IS NULL OR char_length(catchphrase) BETWEEN 1 AND 500 AND btrim(catchphrase)=catchphrase);
