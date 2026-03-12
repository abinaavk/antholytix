function sendSuggestion(){

let message = document.getElementById("suggestionMessage").value;

if(message.trim() === ""){
alert("Please type a suggestion first.");
return;
}

let email = "yourgmail@gmail.com";
let subject = "Antholytix AI Website Suggestion";
let body = encodeURIComponent(message);

window.location.href =
`mailto:${email}?subject=${subject}&body=${body}`;

}


const headers = document.querySelectorAll(".accordion-header");

headers.forEach(header => {

header.addEventListener("click", () => {

const content = header.nextElementSibling;

header.classList.toggle("active");

if(content.style.maxHeight){
content.style.maxHeight = null;
}
else{
content.style.maxHeight = content.scrollHeight + "px";
}

});

});

function shareProject(){

let projectURL = "https://your-website-link.com";

let shareTitle = "Antholytix AI – Smart Food Freshness Detection";

let shareText =
shareTitle + "\n\n" +
"Antholytix AI is a chemistry-based innovation that studies natural anthocyanin indicator colour changes to detect food spoilage.\n\n" +
projectURL + "\n\n" +
"Chemistry quietly protects our health every day — from understanding food freshness to helping us make safer and smarter choices for a healthier life.";

if(navigator.share){

navigator.share({
text: shareText
});

}
else{

navigator.clipboard.writeText(shareText);

alert("Project message copied! You can now paste and share it.");

}

}

document.getElementById("cameraInput").addEventListener("change", function(event){

const file = event.target.files[0];

if(file){
alert("Image captured successfully! Processing freshness indicator...");
}

});