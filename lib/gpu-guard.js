// Admission uses measured per-profile VRAM; it does not control other plugins.
export function checkMemory(info,requiredMiB){
 if(requiredMiB>0 && info.freeMiB < requiredMiB+128){
  throw new Error(`Not enough free GPU memory to load this profile safely: ${Math.floor(info.freeMiB)} MiB available; at least ${Math.ceil(requiredMiB+128)} MiB required including a 128 MiB startup margin. Stop other GPU workloads or choose a smaller context/profile, then retry. No model was launched.`);
 }
}
