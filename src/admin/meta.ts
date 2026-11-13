// Labels and colors for project status, shared by the projects table and the project page.
import type { Project } from '@/domain/types';
import { colors } from '@/theme';

export const STATUS_META: Record<Project['status'], { label: string; color: string }> = {
  active: { label: 'Active', color: colors.success },
  complete: { label: 'Complete', color: colors.info },
  archived: { label: 'Archived', color: colors.textFaint },
};
