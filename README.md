# Antigravity LED Schedule & Orchestrator

A containerized, Kubernetes-native low-code scheduling and orchestration system for the **NightDriver C++ Server (NDSCPP)**. Designed to run securely on home servers, this app handles time-based schedules, webhook executions, and real-time sports scoring triggers (e.g. goal celebrations) with a canvas-based animation preview in the web browser.

---

## 1. System Architecture

*   **Frontend**: Built with Vite + React + TypeScript and styled with a sleek dark-mode glassmorphism interface. Features an HTML5 canvas animation preview, layout metrics visualizer, and a visual pipeline schedule builder.
*   **Backend**: A lightweight Node.js + TypeScript service managing triggers (Cron, webhook keys, ESPN score polling). Directly proxies REST calls to the in-cluster C++ server.
*   **Storage**: Manifest-driven. The backend loads and saves all schedule definitions into a single YAML/JSON manifest (`manifest.yaml`), which is persistent via local volumes or Kubernetes PVCs (no external database required).

---

## 2. Sports Scoring Triggers (ESPN Scoreboard API)

The orchestrator integrates with the unofficial, public ESPN scoreboard API. It queries live scores every 30 seconds for matches involving your configured team (e.g., `Green Bay Packers` or `Chicago Blackhawks`).

*   **Zero API Keys**: Uses standard ESPN Web/App APIs.
*   **Intelligent Polling**: Automatically scales polling intervals down to 5 minutes when no game is active to protect resource limits and avoid rate-limiting. Once a game begins, it polls every 30 seconds.
*   **Celebration Pipelines**: Can chain actions to flash team colors upon score increase, hold for N seconds, and restore default settings.

---

## 3. Local Development Setup

To run the application locally, you can start the frontend and backend separately in development mode:

### Prerequisites
- Node.js (v18+) and npm installed.
- Access to an active C++ server (e.g. `http://led-controller.local:7777` or `http://192.168.1.100:7777`).

### Step 1: Run the Backend
1. Navigate to `/backend` folder.
2. Create a `.env` file (optional):
   ```env
   PORT=5000
   ADMIN_PASSWORD=admin
   NDSCPP_HOST=192.168.1.100
   NDSCPP_PORT=7777
   ```
3. Install dependencies and start:
   ```bash
   npm install
   npm run dev
   ```

### Step 2: Run the Frontend
1. Navigate to `/frontend` folder.
2. Install dependencies and start the Vite dev server:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:5173` in your browser. All API requests starting with `/api` are automatically proxied to the backend on port 5000.

---

## 4. Building Containers

To package the application as a single Docker container (using the multi-stage Dockerfile):

```bash
# Build the unified image
docker build -t led-schedule:latest .
```

---

## 5. Kubernetes Deployment

The app includes all manifests under the `k8s/` folder. Apply them in order to deploy:

```bash
# 1. Apply secrets (default password: "admin")
kubectl apply -f k8s/secrets.yaml

# 2. Apply persistent volume claim for manifests
kubectl apply -f k8s/pvc.yaml

# 3. Apply workloads (Frontend and Backend deployments + services)
kubectl apply -f k8s/deployment.yaml

# 4. Apply Ingress router
kubectl apply -f k8s/ingress.yaml
```

*Note: If you want to deploy a template instance of the NDSCPP C++ server in the same cluster, see the example in [k8s/ndscpp-template.yaml](file:///home/matt/led-schedule/k8s/ndscpp-template.yaml).*

---

## 6. Security Design

*   **Public Webhooks**: Only `/api/v1/webhooks/trigger/:token` is exposed publicly on Ingress. It is secured by a high-entropy random token.
*   **Admin Dashboard**: All configuration APIs, layout updates, and control routes require an HTTP-only secure cookie containing a JWT signature.
*   **Private C++ Server**: The Ingress blocks all public access to the raw C++ REST port (7777), keeping local light channels fully private within the Kubernetes cluster network.
