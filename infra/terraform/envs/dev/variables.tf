variable "kubeconfig_path" {
  description = "Ruta absoluta opcional al kubeconfig del clúster dev; por defecto usa .tools/kubeconfig."
  type        = string
  default     = null
}
