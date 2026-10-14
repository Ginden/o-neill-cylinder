uniform sampler2D uPreviewLight;
uniform sampler2D uSurfaceLight;
uniform mat3 uMaterialXYZ;
uniform vec3 uLampXYZ;
uniform int uSurfaceKind;
in vec3 vWorld;
out vec4 outColor;
// Filtered atlas lookup, offset by whole texels, that stays within the texel
// centres of one region: the wall (which wraps around) or one endcap.
vec3 atlasLight(sampler2D atlas,vec2 uv,bool endcap,vec2 offset) {
  vec2 size=vec2(textureSize(atlas,0)),margin=0.5/size;
  vec2 low=endcap ? vec2(uv.x<0.5 ? 0.0 : 0.5,ATLAS_WALL) : vec2(-1e3,0.0);
  vec2 high=endcap ? low+vec2(0.5,1.0-ATLAS_WALL) : vec2(1e3,ATLAS_WALL);
  return texture(atlas,clamp(uv+offset/size,low+margin,high-margin)).rgb;
}
void main() {
  vec3 p=vWorld;
  bool endcap=uSurfaceKind==1;
  if(!endcap && windowOpening(p)) discard;
  vec3 normal=endcap ? vec3(0,0,-sign(p.z)) : -normalize(vec3(p.xy,0));
  vec3 albedo=endcap ? endcapAlbedo(p) : windowAt(atan(p.y,p.x)) ? vec3(0.38,0.43,0.46) : groundAlbedo(p,normal);
  // The raster mesh has no trees; tree cover stands in for their crowns.
  if(!endcap) albedo=mix(albedo,vec3(0.035,0.08,0.028),0.9*coverAt(groundCoordinates(p)).r);
  // Direct sunlight from the analytic bake, and light that has scattered or
  // reflected at least once, traced per reflectance band (both relative to
  // sunlight). Scattered light varies slowly: a tent over 4 × 4 texels hides
  // the sampling noise of a young atlas.
  vec2 uv=surfaceAtlasCoordinates(p,endcap);
  vec3 light=atlasLight(uPreviewLight,uv,endcap,vec2(0.0));
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++)
    light+=atlasLight(uSurfaceLight,uv,endcap,vec2(x,y))*float((2-abs(x))*(2-abs(y)))/16.0;
  vec3 color=uMaterialXYZ*(albedo*light)/PI;
  if(uSolarPower<0.02 && !endcap && !windowAt(atan(p.y,p.x))) {
    color+=settlementLamp(groundCoordinates(p))*uLampXYZ/uReferenceIlluminance;
  }
  outColor=vec4(encodeSRGB(displayColor(color)),1.0);
}
