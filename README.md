# Copilot-Bot

Copilot-Bot is a multi-platform chatbot for mobile and PC that connects to multiple AI model APIs through a unified experience. The project is designed around practical automation use cases, making it easier to build, run, and manage AI-assisted scripts and workflows from a single interface.

## Project Goals

- Provide one chatbot experience across mobile and desktop environments.
- Integrate multiple AI model APIs behind a consistent user workflow.
- Support automation-focused interactions, including script generation, refinement, and execution support.
- Create a foundation that is scalable, secure, and easy to extend with additional providers and automation features.

## Key Features

### Automation

- AI-assisted creation and refinement of automation scripts.
- Support for repetitive task workflows such as data handling, content processing, and operational scripting.
- Centralized access to multiple model providers for comparing and selecting the best output for automation tasks.
- Extensible architecture for future scheduling, orchestration, and tool integration features.

### Multi-platform

- Unified chatbot experience for both mobile and PC users.
- Responsive interface patterns adapted for touch and desktop interaction.
- Shared access to conversations, automation ideas, and model-driven workflows across devices.
- Platform-flexible design to support growth across operating systems and device types.

## Tech Stack

- Frontend: React Native for a shared multi-platform client experience.
- Backend: Node.js and TypeScript for API orchestration, proxy services, and business logic.
- AI Integrations: Multiple external AI model APIs, with support for provider abstraction and routing.
- Automation Focus: Script-oriented workflows and service integrations built on top of the chatbot platform.

## Use Cases

- Generate automation scripts for routine development or operations tasks.
- Compare outputs from different AI providers for technical problem-solving.
- Manage AI-assisted workflows from either a mobile device or desktop environment.
- Build a central chatbot layer for future automation tooling and integrations.

## Roadmap

- Expand supported AI providers and routing options.
- Add stronger workflow management for automation scenarios.
- Introduce security and governance controls for prompt handling and provider usage.
- Improve observability, error handling, and deployment readiness.

## Deployment

### Render Migration

This repository is set up to migrate from Railway to Render with a split deployment model:

- Backend: Docker-based Render Web Service
- Frontend: Render Static Site for the Vite build output

Key deployment files:

- [Dockerfile](Dockerfile)
- [.dockerignore](.dockerignore)
- [render.yaml](render.yaml)
- [RENDER.md](RENDER.md)

Recommended migration sequence:

1. Deploy the backend Web Service first.
2. Verify the backend health endpoint at `/health`.
3. Deploy the frontend Static Site.
4. Set `VITE_BACKEND_ORIGIN` in the frontend environment to the Render backend URL.
5. Verify that the frontend enters live mode and displays backend metadata correctly.

### Render Free Tier Note

Render free services can spin down after inactivity. Expect cold-start latency on the first request after idle time. For chat UX, a frontend warm-up request to `/health` is recommended.

## License

Add the appropriate license information for this project here.
