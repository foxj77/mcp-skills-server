{{/*
Expand the name of the chart.
*/}}
{{- define "mcp-skills-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
Truncated to 63 characters because Kubernetes name fields have this limit.
If the release name already contains the chart name, avoid duplicating it.
*/}}
{{- define "mcp-skills-server.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label value: "<name>-<version>" with "+" replaced by "_".
*/}}
{{- define "mcp-skills-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to all resources.
*/}}
{{- define "mcp-skills-server.labels" -}}
helm.sh/chart: {{ include "mcp-skills-server.chart" . }}
{{ include "mcp-skills-server.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used by the Deployment selector and Service selector.
These must never change after initial install; Kubernetes rejects selector
mutations on existing Deployments.
*/}}
{{- define "mcp-skills-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mcp-skills-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Fully-qualified image reference.
Tag falls back to .Chart.AppVersion when values.image.tag is empty,
so a plain `helm upgrade` always uses the version the chart was built for.
*/}}
{{- define "mcp-skills-server.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}

{{/*
Full in-cluster MCP endpoint URL.
Composed from the service name, release namespace, and service port so that
the RemoteMCPServer spec and NOTES.txt always stay in sync with the actual
service, even when nameOverride or fullnameOverride is set.
*/}}
{{- define "mcp-skills-server.mcpEndpoint" -}}
{{- printf "http://%s.%s.svc.cluster.local:%d/mcp" (include "mcp-skills-server.fullname" .) .Release.Namespace (.Values.service.port | int) }}
{{- end }}

{{/*
Webhook endpoint URL (in-cluster, for reference in NOTES.txt).
*/}}
{{- define "mcp-skills-server.webhookEndpoint" -}}
{{- printf "http://%s.%s.svc.cluster.local:%d/webhook" (include "mcp-skills-server.fullname" .) .Release.Namespace (.Values.webhook.port | int) }}
{{- end }}
