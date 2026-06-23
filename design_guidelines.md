# Design Guidelines: Business Trip Planning Application

## Design Approach
**System-Based Approach**: Using **Fluent Design System** principles, optimized for enterprise productivity applications with complex data management and approval workflows. Drawing inspiration from Linear and Asana for clean, efficient interfaces that prioritize information hierarchy and task completion.

## Core Design Principles
1. **Information Clarity**: Dense data presentation without visual clutter
2. **Workflow Efficiency**: Minimize clicks for common tasks
3. **Role-Based Hierarchy**: Clear visual distinction between user permission levels
4. **Professional Aesthetic**: Corporate-appropriate, trustworthy interface

---

## Typography System

**Font Family**: 
- Primary: 'Inter' (Google Fonts) - exceptional readability for data-heavy interfaces
- Monospace: 'JetBrains Mono' - for dates, IDs, reference numbers

**Hierarchy**:
- Page Headers: text-2xl font-semibold (32px)
- Section Headers: text-lg font-semibold (20px)
- Card Titles: text-base font-medium (16px)
- Body Text: text-sm (14px)
- Supporting Text: text-xs text-gray-600 (12px)
- Table Headers: text-xs font-medium uppercase tracking-wide

---

## Layout System

**Spacing Primitives**: Use Tailwind units **2, 4, 6, 8, 12** exclusively
- Component padding: p-4, p-6
- Section gaps: gap-6, gap-8
- Page margins: m-8, m-12
- Card spacing: space-y-4

**Grid Structure**:
- Sidebar Navigation: 256px fixed width (w-64)
- Main Content: flex-1 with max-w-7xl container
- Dashboard Cards: grid-cols-1 md:grid-cols-2 lg:grid-cols-3
- Data Tables: Full-width within container

**Container Strategy**:
- App shell: Full viewport height with sidebar + main content
- Content sections: px-8 py-6 with max-w-7xl mx-auto
- Modal dialogs: max-w-2xl centered

---

## Component Library

### Navigation
- **Sidebar Navigation** (Fixed Left):
  - Logo/Company name at top (h-16)
  - Role badge showing current user's position
  - Hierarchical menu structure with icons
  - Active state: Subtle left border + background
  - Collapsible sections for different modules

- **Top Bar**:
  - Breadcrumb navigation (text-sm)
  - Quick actions (+ New Trip button)
  - User profile dropdown (right-aligned)
  - Notification bell with badge counter

### Core UI Elements

**Cards**:
- Standard: rounded-lg border shadow-sm p-6
- Elevated: shadow-md for important items
- Interactive: hover:shadow-lg transition cursor-pointer
- Status indicators: Colored left border (4px) for approval states

**Tables**:
- Sticky header row with subtle shadow on scroll
- Alternating row backgrounds (odd:bg-gray-50)
- Action column (right-aligned) with icon buttons
- Row hover: bg-blue-50 transition
- Sortable columns with arrow indicators
- Pagination footer

**Buttons**:
- Primary CTA: px-4 py-2 rounded-md font-medium
- Secondary: border variant
- Icon buttons: p-2 rounded-md for table actions
- Danger actions: Red variant for deletions
- Button groups: Adjacent with shared borders

### Forms
- **Input Fields**:
  - Label above input (text-sm font-medium mb-2)
  - Input: px-3 py-2 border rounded-md
  - Error state: Red border + error message below
  - Required fields: Red asterisk after label
  
- **Dropdowns/Selects**:
  - Native select styling with custom arrow
  - Multi-select with chips for selected items
  - Searchable dropdowns for large lists (cities, employees)

- **Date Pickers**:
  - Calendar popup with range selection
  - Quick presets (This week, Next month)
  - Visual indicator for weekends/holidays

### Data Displays

**Calendar View**:
- Month/Week/List view toggle
- Color-coded trips by status (Pending/Approved/Rejected)
- Compact event cards showing: Employee name, City, Dates
- Click to expand details panel

**Status Badges**:
- Rounded-full px-3 py-1 text-xs font-medium
- Pending: Yellow background
- Approved: Green background
- Rejected: Red background
- Draft: Gray background

**Employee Hierarchy Cards**:
- Avatar circle (40px) + Name + Role
- Reporting line visualization (dotted connectors)
- Quick stats (trips this month, pending approvals)

### Approval Workflow Components

**Approval Queue**:
- List view with expandable rows
- Trip details in accordion format
- Approve/Reject buttons with comment field
- Batch selection for multi-approval
- Filter by: Date range, Employee, Destination

**Trip Request Form**:
- Step indicator (1/3, 2/3, 3/3) if multi-step
- Destination autocomplete with city suggestions
- Date range picker with validation
- Purpose textarea (max-w-prose)
- Cost estimate fields
- Submit for approval CTA

---

## Icons
**Library**: Heroicons (outline for navigation, solid for states)
- Navigation: Building, Calendar, Users, Map, Settings
- Actions: Plus, Pencil, Trash, Check, X
- Status: Clock, CheckCircle, XCircle, ExclamationTriangle

---

## Images
No hero images needed - this is a business application, not marketing site. Focus on data visualization and functional UI.

**Optional Visual Elements**:
- Empty states: Simple illustrations (via undraw.co)
- User avatars: Initials fallback if no photo
- City thumbnails: Small (80px) for trip cards if enhancing UX

---

## Accessibility & Interactions

- All interactive elements: min-height: 44px (touch-friendly)
- Keyboard navigation: Focus rings (ring-2 ring-blue-500)
- ARIA labels for icon-only buttons
- Form validation: Real-time with clear error messages
- Loading states: Skeleton screens for tables/cards
- No animations except: Smooth transitions (150ms) for hovers/dropdowns

---

## Responsive Behavior

**Mobile (< 768px)**:
- Sidebar collapses to hamburger menu
- Tables switch to card layout
- Calendar switches to list view default
- Stack form fields vertically

**Desktop (≥ 1024px)**:
- Sidebar always visible
- Multi-column dashboards
- Table view preferred
- Side-by-side form layouts