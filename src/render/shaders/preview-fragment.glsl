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
  vec2 uv=vec2((atan(p.y,p.x)+PI)/(2.0*PI),p.z/uLength+0.5);
  vec3 color=uSurfaceKind==1 ? vec3(0.0) : (uMaterialXYZ*albedo)*texture(uPreviewLight,uv).rgb/PI;
  if(uSolarPower<0.02 && uSurfaceKind==0 && !windowAt(atan(p.y,p.x))) {
    vec2 ground=groundCoordinates(p);
    float city=step(0.66,noise(ground*1.4+113.0))*(1.0-smoothstep(0.18,0.45,riverDistance(ground)));
    float lamp=step(0.94,hash(floor(ground*80.0)));
    color+=city*lamp*uLampXYZ/uReferenceIlluminance;
  }
  outColor=vec4(encodeSRGB(displayColor(color)),1.0);
}
