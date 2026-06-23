# Business Trip Planning Application

## Overview
This professional web application streamlines business trip planning and approval within organizations. It features a hierarchical management system for various roles, aiming to enhance operational efficiency by managing approval workflows, enforcing "subordinate-manager" hierarchies, tracking trip statuses, and managing employee and city directories. The core purpose is to provide a robust, user-friendly platform for efficient employee travel management.

## User Preferences
- Language: Russian (ru)
- Design: Professional, corporate, clean
- Focus: Data clarity, workflow efficiency
- Theme: Light mode default with dark mode support
- User management: Admin-only access to add/delete employees with role-based UI restrictions

## System Architecture

### Core Design
The application is built with a React 18 and TypeScript frontend, using Wouter for routing and TanStack Query for data fetching. UI components are styled with Shadcn UI and Tailwind CSS, adhering to Fluent Design principles, and supporting responsive design and dark mode. The backend is Express.js, persisting all data to a PostgreSQL database via Drizzle ORM for type-safe queries. Session authentication uses `express-session`, and API validation is handled by Zod.

### Feature Specifications
- **Role-Based Access**: Supports various roles (e.g., Medical Representatives, Managers, Directors) with dynamic UI restrictions.
- **Hierarchical Management**: Implements "subordinate-manager" relationships and department-based access control, limiting visibility and approval rights to relevant personnel.
- **Trip Lifecycle Management**: Enables creation, editing, and deletion of business trips with defined statuses (draft, pending, approved, rejected) and a multi-level approval workflow including comments and notifications.
- **Reporting & Analytics**: Provides a dashboard with key statistics (total, pending, approved, active trips) and an admin-exclusive monthly trips registry report with daily allowance calculations, exportable to Excel.
- **User Management**: Features include personal profile pages, secure password changes, contact admin functionality, and email notifications for credentials. Admins can manage employee data, roles, and hierarchy, with automatic role assignment based on job titles.
- **Data Handling**: Supports Excel uploads for employee data using UPSERT logic to manage user records.
- **Security**: Utilizes session-based authentication, SHA256 password hashing, and `requireAdmin` middleware for sensitive operations.

### Key Architectural Decisions
- **Frontend Framework**: React 18 with TypeScript for robust and scalable UI.
- **State Management**: TanStack Query for efficient data fetching and caching.
- **Styling**: Shadcn UI and Tailwind CSS for a consistent, professional, and customizable UI.
- **Backend Framework**: Express.js for a flexible and performant API layer.
- **Database**: PostgreSQL with Drizzle ORM for type-safe and reliable data persistence.
- **Authentication**: Session-based with `express-session` for secure user sessions.
- **API Validation**: Zod for strong data integrity and type safety.
- **Access Control**: Granular, department-based access and role-based permissions ensure data security and proper workflow execution.

## External Dependencies

-   **Frontend Libraries**: React, TypeScript, Wouter, TanStack Query, Shadcn UI, Tailwind CSS, date-fns, Lucide React.
-   **Backend Libraries**: Express.js, Zod, express-session.