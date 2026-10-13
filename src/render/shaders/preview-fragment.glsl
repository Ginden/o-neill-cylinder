uniform sampler2D uPreviewLight;
uniform mat3 uMaterialXYZ;
uniform vec3 uLampXYZ;
uniform int uSurfaceKind;
in vec3 vWorld;
out vec4 outColor;
void main() {
  vec3 p=vWorld;
  if(uSurfaceKind==0 && windowOpening(p)) discard;
  vec3 normal=uSurfaceKind==1 ? vec3(0,0,-sign(p.z)) : -normalize(vec3(p.xy,0));
  vec3 albedo=uSurfaceKind==1 ? vec3(0.23,0.28,0.3) : windowAt(atan(p.y,p.x)) ? vec3(0.38,0.43,0.46) : groundAlbedo(p,normal);
  // The raster mesh has no trees; tree cover stands in for their crowns.
  if(uSurfaceKind==0) albedo=mix(albedo,vec3(0.035,0.08,0.028),0.9*coverAt(groundCoordinates(p)).r);
  vec2 uv=atlasCoordinates(p);
  vec3 color=uSurfaceKind==1 ? vec3(0.0) : (uMaterialXYZ*albedo)*texture(uPreviewLight,uv).rgb/PI;
  if(uSolarPower<0.02 && uSurfaceKind==0 && !windowAt(atan(p.y,p.x))) {
    color+=settlementLamp(groundCoordinates(p))*uLampXYZ/uReferenceIlluminance;
  }
  outColor=vec4(encodeSRGB(displayColor(color)),1.0);
}
