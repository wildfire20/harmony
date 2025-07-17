-- Migration: Add teacher_comments column to submissions table
ALTER TABLE submissions
ADD COLUMN IF NOT EXISTS teacher_comments TEXT;
