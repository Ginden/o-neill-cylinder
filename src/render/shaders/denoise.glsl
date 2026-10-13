uniform sampler2D uInput;
uniform sampler2D uGuideGeometry;
uniform sampler2D uGuideAlbedo;
uniform vec2 uSize;
uniform float uStride;
uniform float uSamples;
out vec4 outColor;
float kernel(int i) {return i==0 ? 2.0 : 1.0;}
vec3 reflectance(vec4 albedo) {
  if(albedo.a>1.5) return vec3(1.0);
  return max(vec3(0.025),vec3(dot(vec3(0.4124,0.3576,0.1805),albedo.rgb),
    dot(vec3(0.2126,0.7152,0.0722),albedo.rgb),dot(vec3(0.0193,0.1192,0.9505),albedo.rgb)));
}
void main() {
  ivec2 center=ivec2(gl_FragCoord.xy);
  vec4 inputValue=texelFetch(uInput,center,0);
  vec4 geometry=texelFetch(uGuideGeometry,center,0);
  vec4 albedo=texelFetch(uGuideAlbedo,center,0);
  vec3 base=reflectance(albedo),value=inputValue.rgb/base;
  float variance=max(0.0,inputValue.a-dot(inputValue.rgb,inputValue.rgb)/3.0);
  float sigma=max(0.015,3.0*sqrt(variance/max(1.0,uSamples)))/base.y;
  vec3 sum=vec3(0.0);float total=0.0;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    ivec2 p=clamp(center+ivec2(vec2(x,y)*uStride),ivec2(0),ivec2(uSize)-1);
    vec4 otherGeometry=texelFetch(uGuideGeometry,p,0),otherAlbedo=texelFetch(uGuideAlbedo,p,0);
    if (abs(otherAlbedo.a-albedo.a)>0.1) continue;
    vec4 otherInput=texelFetch(uInput,p,0);
    vec3 other=otherInput.rgb/reflectance(otherAlbedo);
    float normalWeight=pow(max(0.0,dot(geometry.xyz,otherGeometry.xyz)),16.0);
    float depthWeight=exp(-abs(geometry.a-otherGeometry.a)/max(0.025,geometry.a*0.025*uStride));
    float difference=value.y-other.y;
    float colorWeight=exp(-difference*difference/(sigma*sigma));
    float weight=kernel(x)*kernel(y)*normalWeight*depthWeight*colorWeight;
    sum+=weight*other;total+=weight;
  }
  outColor=vec4(sum/max(total,1e-8)*base,inputValue.a);
}
