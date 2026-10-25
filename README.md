# Savora Backend

Backend services for **Savora**, an AI-powered cooking assistant that helps users discover recipes based on available ingredients.

The backend connects the application with AI services, manages recipe-related operations, and handles communication between the frontend and external services.

## Features

### AI Recipe Generation

* Generate recipes based on available ingredients
* Process cooking preferences and user instructions
* Return structured recipe data
* Suggest ingredient substitutions
* Modify existing recipes based on follow-up requests

### Ingredient Processing

* Process ingredient data submitted by users
* Prepare ingredient lists for recipe generation
* Support ingredient-based recipe recommendations
* Handle ingredient information received from the frontend

### Conversational Cooking Assistant

The backend supports AI-powered conversations focused on cooking and recipe customization.

Users can ask follow-up questions, replace ingredients, adjust cooking instructions, and request alternative recipes.

### Recipe Management

Recipe-related operations may include:

* Recipe generation and modification
* Ingredient quantities and cooking instructions
* Recipe details
* Saved recipes
* User-specific recipe data

### User Management

Depending on the configured authentication system, the backend supports:

* Authentication and session validation
* User-specific data management
* Access control for protected operations

### Data Management

The backend integrates with the configured database services to manage application data.

Potential data entities include:

* Users
* Ingredients
* Recipes
* Saved recipes
* Conversation history
* User preferences

The actual data model depends on the implementation.

## Technology Stack

| Component         | Technology                         |
| ----------------- | ---------------------------------- |
| Backend Framework | Project-specific                   |
| Database          | Project-specific                   |
| AI Integration    | AI API                             |
| Authentication    | Configured authentication provider |
| API Communication | HTTP / REST, where implemented     |
| Configuration     | Environment variables              |

## Architecture

```text
Frontend
   |
   v
Backend Services
   |
   +-- Request Validation
   |
   +-- Ingredient Processing
   |
   +-- AI Integration
   |      |
   |      +-- Recipe Generation
   |      +-- Recipe Modification
   |      +-- Cooking Assistance
   |
   +-- Database Operations
   |
   +-- Response Processing
          |
          v
       Frontend
```

## Environment Configuration

Sensitive credentials should be stored in environment variables and excluded from version control.

Create a `.env` file with the configuration required by the application.

```env
PORT=

AI_API_KEY=

DATABASE_URL=

AUTH_URL=
AUTH_SECRET=
```

These variables are examples. Use the actual environment variable names required by the project.

### Security Considerations

* Never commit credentials or private API keys.
* Keep server-side AI credentials out of client-side code.
* Validate incoming requests.
* Protect endpoints that require authentication.
* Apply appropriate access controls to user-specific data.
* Avoid exposing sensitive information in error responses.

## Getting Started

### Prerequisites

Install the runtime and package manager required by the project. For a Node.js backend, this typically means:

* Node.js
* npm
* Access to the configured database
* Credentials for the selected AI provider

### Installation

Clone the repository:

```bash
git clone <repository-url>
cd <backend-directory>
```

Install dependencies:

```bash
npm install
```

Configure the required environment variables before starting the application.

### Development

Run the development command defined in `package.json`.

For a project configured with a `dev` script:

```bash
npm run dev
```

The exact command depends on the project's configuration.

## Project Structure

The following is an example structure. Replace it with the actual directory layout of the repository.

```text
savora-backend/
├── src/
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   ├── database/
│   ├── utils/
│   └── app.*
├── tests/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## API Documentation

Document the implemented endpoints with the following information:

* HTTP method and route
* Authentication requirements
* Request parameters and body
* Response structure
* Error responses
* Example requests

## Project Status

**Status:** In Development

Savora's backend provides the application services required for AI-assisted recipe generation, ingredient processing, and recipe-related data management.

## License

Specify the applicable license before distributing or reusing this project.
