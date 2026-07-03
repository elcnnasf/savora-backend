import { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  is_premium: boolean;
  is_pro: boolean;
  is_admin: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

export interface Profile {
  id: string;
  name: string;
  avatar_url: string | null;
  is_premium: boolean;
  premium_since: string | null;
  member_since: string;
  cooking_skill: 'beginner' | 'intermediate' | 'advanced';
  calorie_goal: number;
}

export interface Recipe {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  calories: number | null;
  protein: number | null;
  cook_time: number;
  prep_time: number;
  servings: number;
  difficulty: 'easy' | 'medium' | 'hard';
  cuisine: string | null;
  tags: string[];
  ingredients: { name: string; amount: string }[];
  steps: { step: number; instruction: string; duration?: number }[];
  is_ai_generated: boolean;
  created_at: string;
}
