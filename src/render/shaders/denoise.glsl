uniform sampler2D uInput;
uniform sampler2D uGuideGeometry;
uniform sampler2D uGuideAlbedo;
uniform vec2 uSize;
uniform float uStride;
uniform float uSamples;
out vec4 outColor;
float kernel(int i) {return i==0 ? 2.0 : 1.0;}
void main() {
  ivec2 center=ivec2(gl_FragCoord.xy);
  vec4 inputValue=texelFetch(uInput,center,0);
  vec4 geometry=texelFetch(uGuideGeometry,center,0);
  vec4 albedo=texelFetch(uGuideAlbedo,center,0);
  vec3 value=inputValue.rgb;
  float variance=max(0.0,inputValue.a-dot(inputValue.rgb,inputValue.rgb)/3.0);
  // A pixel with no successful paths has zero sample variance, not certainty
  // that it is black. Pool nearby uncertainty so those pixels can converge too.
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
    ivec2 p=clamp(center+ivec2(x,y),ivec2(0),ivec2(uSize)-1);
    vec4 neighbor=texelFetch(uInput,p,0);
    variance=max(variance,max(0.0,neighbor.a-dot(neighbor.rgb,neighbor.rgb)/3.0));
  }
  float sigma=max(0.00001,3.0*sqrt(variance/max(1.0,uSamples)));
  vec3 sum=vec3(0.0);float total=0.0;
  for (int y=-1;y<=1;y++) for (int x=-1;x<=1;x++) {
    ivec2 p=clamp(center+ivec2(vec2(x,y)*uStride),ivec2(0),ivec2(uSize)-1);
    vec4 otherGeometry=texelFetch(uGuideGeometry,p,0),otherAlbedo=texelFetch(uGuideAlbedo,p,0);
    if (albedo.a>=0.0 && otherAlbedo.a>=0.0 && abs(otherAlbedo.a-albedo.a)>0.1) continue;
    vec4 otherInput=texelFetch(uInput,p,0);
    // Filter total radiance in XYZ. Dividing by surface albedo would also
    // divide the additive in-scattered light, imprinting fields onto the haze.
    vec3 other=otherInput.rgb;
    vec3 delta=albedo.rgb-otherAlbedo.rgb;
    float albedoWeight=albedo.a<0.0 || otherAlbedo.a<0.0 || albedo.a>1.5
      ? 1.0 : exp(-dot(delta,delta)/0.0064);
    float normalWeight=pow(max(0.0,dot(geometry.xyz,otherGeometry.xyz)),16.0);
    float depthWeight=exp(-abs(geometry.a-otherGeometry.a)/max(0.025,geometry.a*0.025*uStride));
    float difference=value.y-other.y;
    float colorWeight=exp(-difference*difference/(sigma*sigma));
    float weight=kernel(x)*kernel(y)*albedoWeight*normalWeight*depthWeight*colorWeight;
    sum+=weight*other;total+=weight;
  }
  outColor=vec4(sum/max(total,1e-8),inputValue.a);
}
